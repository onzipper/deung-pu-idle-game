"use client";

/**
 * The game-loop host: the seam where the pure engine, the Pixi renderer, and
 * the React HUD meet.
 *
 * Owns the live `GameState` and the render `Application` as plain closures
 * inside a single `useEffect` (never React state — see `CLAUDE.md`'s no
 * per-frame-state-in-React rule). Each rAF tick:
 *   1. copies the UI-owned `speed`/`autoUpgrade`/`autoCast` flags off the
 *      Zustand store onto the engine state,
 *   2. drains the one-shot player-intent queue (`drainPendingInput`) exactly
 *      once and hands it to the FIRST fixed sub-step of the frame,
 *   3. asks the fixed-timestep accumulator how many `FIXED_DT` sub-steps to
 *      run (the speed multiplier = more sub-steps, never a bigger dt) and
 *      runs `step()` that many times, concatenating each sub-step's
 *      `state.events` into one `frameEvents` array (M4 juice feed — the buffer
 *      is cleared at the START of every step(), so a multi-sub-step frame
 *      must collect across all of them or a speed multiplier silently drops
 *      events),
 *   4. draws the resulting state + `frameEvents` with the (one-way,
 *      read-only) `GameRenderer`, which reacts to them on its `fx` layer,
 *   5. at the throttled `CONFIG.uiSyncHz` cadence, pushes a HUD-only snapshot
 *      back into the store via `syncFromEngine`.
 *
 * No game logic lives here — this only pumps input -> step -> draw -> snapshot.
 * Save/load (M3) hooks in at two points: pass a loaded `SaveData` into
 * `initGameState(seed, save)` on mount, and periodically/on-unload serialize
 * the relevant `GameState` fields back out.
 */

import { useEffect, useRef } from "react";
import {
  CONFIG,
  FIXED_DT,
  bossHint,
  createAccumulator,
  drainAccumulator,
  initGameState,
  migrate,
  step,
  toSaveData,
  upgradeCost,
  type FrameInput,
  type GameEvent,
  type GameState,
  type SaveData,
} from "@/engine";
import { GameRenderer } from "@/render/GameRenderer";
import { GameHud } from "@/ui/components/GameHud";
import {
  useGameStore,
  type EngineSnapshot,
  type HeroSummary,
} from "@/ui/store/gameStore";

/** Wall-clock seconds between throttled engine -> UI snapshots. */
const UI_SYNC_INTERVAL = 1 / CONFIG.uiSyncHz;

/**
 * Clamp per-frame elapsed wall time (tab-away, debugger pauses, dropped
 * frames) so a stall never dumps a huge burst of sub-steps into one rAF.
 * Real offline-idle catch-up is a separate, capped M3 concern (`server/offline.ts`).
 */
const MAX_FRAME_SECONDS = 0.25;

/** Wall time between periodic autosave POSTs. */
const AUTOSAVE_INTERVAL_MS = 30_000;

/**
 * Wall-clock budget for replaying capped offline-idle time synchronously on
 * load. A full `offlineCapHours` (8h ≈ 1.7M fixed steps @60Hz) would freeze the
 * tab, so we replay as many real `step()`s as fit in this budget and DROP the
 * remainder. Bounded by wall time (not a fixed step count) so it stays jank-free
 * on any machine. Exact long-idle fidelity is an M4 concern (a coarse
 * closed-form idle-rate model, or a chunked/worker catch-up).
 */
const OFFLINE_SYNC_BUDGET_MS = 250;

/** Wall-clock timeout for the blocking save-load GET so a hung/flaky network
 * (LAN / Tailscale over plain HTTP on mobile) can never stop the game from
 * starting — on timeout we abort and boot a fresh game. */
const SAVE_LOAD_TIMEOUT_MS = 6_000;

/** Fetch with a hard timeout via AbortController (works on older mobile Safari
 * that lacks `AbortSignal.timeout`). */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the mount element has been laid out to a non-zero size (mobile
 * flex/aspect-ratio can report 0x0 for the first frame or two). Bounded so a
 * genuinely collapsed layout still proceeds (the renderer's own resize guard
 * then keeps it at a safe fallback size until the ResizeObserver fires).
 */
async function waitForNonZeroSize(el: HTMLElement, maxFrames = 10): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (el.clientWidth > 0 && el.clientHeight > 0) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function buildSnapshot(state: GameState): EngineSnapshot {
  const heroes: HeroSummary[] = state.heroes.map((h) => ({
    cls: h.cls,
    hp: h.hp,
    maxHp: h.maxHp,
    skillCd: h.skillCd,
    dead: h.dead,
  }));

  return {
    gold: state.gold,
    stage: state.stage,
    wave: state.wave,
    kills: state.kills,
    killGoal: CONFIG.killGoal(state.stage),
    phase: state.phase,
    bossReady: state.bossReady,
    bossHint: bossHint(state),
    heroes,
    upgrades: { ...state.upgrades },
    upgradeCosts: {
      atk: upgradeCost("atk", state.upgrades.atk),
      speed: upgradeCost("speed", state.upgrades.speed),
      hp: upgradeCost("hp", state.upgrades.hp),
    },
  };
}

export function GameClient() {
  const arenaRef = useRef<HTMLDivElement | null>(null);

  // DEV-ONLY diagnostics: prove hydration actually happened. Fires once on
  // mount; if the inline boot-ping (src/app/layout.tsx) shows up in the dev
  // log but this never does, React never hydrated even though scripts ran.
  // Safe to delete alongside src/app/api/client-log once done debugging.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "hydrated",
        url: window.location.href,
        time: new Date().toISOString(),
      }),
      keepalive: true,
    }).catch(() => {
      /* dev diagnostics only — never let this affect the real app */
    });
  }, []);

  // DEV-ONLY diagnostics: on-device console (eruda) so we can inspect a
  // phone's console/network/DOM without plugging in remote devtools. Dynamic
  // import behind the dev check keeps it out of the production bundle. Safe
  // to delete once done debugging.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    import("eruda")
      .then((m) => m.default.init())
      .catch(() => {
        /* dev diagnostics only */
      });
  }, []);

  useEffect(() => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return;

    const seed = Date.now() >>> 0;
    // Starts cold; if a save loads, `state` is re-initialised from it before the
    // loop begins (below). Keeping it always-defined avoids use-before-assign.
    let state = initGameState(seed);
    const renderer = new GameRenderer();
    const acc = createAccumulator();

    let rafId = 0;
    let lastTime = performance.now();
    let uiSyncAccum = 0;
    let cancelled = false;
    let autosaveTimer: ReturnType<typeof setInterval> | undefined;
    // A non-React DOM node we may append to the (React-owned) arena div to show
    // a fatal init error; tracked so cleanup can remove it before a remount.
    let errorEl: HTMLElement | null = null;

    /**
     * Never fail silently: any init error becomes a visible Thai message inside
     * the arena slot plus a real console.error. This is the safety net that
     * turns an opaque "the game never starts" phone report into a readable
     * cause on-screen (WebGL2 unsupported, save-load crash, Pixi init reject…).
     */
    function showFatalError(reason: string): void {
      if (!arenaEl) return;
      if (!errorEl) {
        errorEl = document.createElement("div");
        errorEl.className =
          "absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm font-medium text-red-300";
        arenaEl.appendChild(errorEl);
      }
      errorEl.textContent = `ไม่สามารถเริ่มเกมได้: ${reason}`;
    }

    function frame(now: number) {
      rafId = requestAnimationFrame(frame);

      const elapsed = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
      lastTime = now;

      const store = useGameStore.getState();

      // UI-owned flags the engine reads directly (not part of FrameInput).
      state.autoUpgrade = store.autoUpgrade;
      state.autoCast = store.autoCast;

      // Drain the one-shot intent queue exactly once per real frame; only the
      // first fixed sub-step of this frame gets it (remaining sub-steps, if
      // the speed multiplier produces more than one, get an empty input).
      const pending = store.drainPendingInput();
      const firstInput: FrameInput = {
        castSkills: pending.castSkills.length ? pending.castSkills : undefined,
        buyUpgrade: pending.buyUpgrade ?? undefined,
        challengeBoss: pending.challengeBoss || undefined,
        advanceStage: pending.advanceStage || undefined,
      };

      // `state.events` is cleared at the START of each step() and holds only
      // that sub-step's events; a speed multiplier runs more than one sub-step
      // per rAF frame, so we must collect across ALL of them before draw() —
      // otherwise 2x/3x speed would silently drop every event but the last
      // sub-step's (see engine/state/events.ts's collection contract).
      const steps = drainAccumulator(acc, elapsed, store.speed);
      const frameEvents: GameEvent[] = [];
      for (let i = 0; i < steps; i++) {
        step(state, i === 0 ? firstInput : {});
        frameEvents.push(...state.events);
      }

      renderer.draw(state, frameEvents);

      uiSyncAccum += elapsed;
      if (uiSyncAccum >= UI_SYNC_INTERVAL) {
        uiSyncAccum -= UI_SYNC_INTERVAL;
        store.syncFromEngine(buildSnapshot(state));
      }
    }

    // ---- M3: autosave (server-authoritative persistence) ----
    // The server validates every field, ignores the client `lastSeen`, and
    // re-stamps it. Fire-and-forget: a dropped autosave just means the next one
    // (or the on-hide beacon) carries the progress.
    function serialize(): SaveData {
      return toSaveData(state);
    }

    function autosave(): void {
      void fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serialize()),
        keepalive: true,
      }).catch(() => {
        /* offline / transient failure — next autosave retries */
      });
    }

    // On tab-hide (covers most real "closing the game" cases): sendBeacon is
    // guaranteed to flush during unload where a normal fetch may be killed.
    function onVisibility(): void {
      if (document.visibilityState !== "hidden") return;
      const blob = new Blob([JSON.stringify(serialize())], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/save", blob);
    }

    // Pixi init + save load run in parallel; the loop starts only after both
    // resolve. Guards against the effect having been cleaned up mid-flight
    // (React Strict Mode's dev mount/unmount/mount) by tearing the renderer
    // back down instead of leaking an orphaned canvas.
    const boot = async (): Promise<void> => {
      // ---- load the server-authoritative save (before initGameState) ----
      let loaded: SaveData | undefined;
      let offlineSeconds = 0;
      let offlineCapped = false;
      try {
        const res = await fetchWithTimeout(
          "/api/save",
          { method: "GET" },
          SAVE_LOAD_TIMEOUT_MS,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            save: SaveData | null;
            offline?: { creditedSeconds: number; capped: boolean };
          };
          // Server already migrated; pass through migrate() again defensively —
          // never trust a received save's shape/version (CLAUDE.md rule).
          if (json.save) loaded = migrate(json.save);
          if (json.offline) {
            offlineSeconds = json.offline.creditedSeconds;
            offlineCapped = json.offline.capped;
          }
        }
      } catch {
        /* first run / network down / slow-LAN timeout: start cold rather than
           blocking the game from ever starting */
      }

      if (cancelled) return;

      if (loaded) state = initGameState(seed, loaded);

      // ---- offline-idle catch-up ----
      // Replay the capped offline seconds through the SAME fixed-step primitive
      // the live loop uses, bounded by OFFLINE_SYNC_BUDGET_MS (see its comment).
      const totalOfflineSteps = Math.floor(offlineSeconds / FIXED_DT);
      if (totalOfflineSteps > 0) {
        const goldBefore = state.gold;
        const deadline = performance.now() + OFFLINE_SYNC_BUDGET_MS;
        let ran = 0;
        for (; ran < totalOfflineSteps; ran++) {
          step(state, {});
          // Amortise the clock read so it doesn't dominate the tight loop.
          if ((ran & 0x3ff) === 0 && performance.now() >= deadline) {
            ran++;
            break;
          }
        }
        // TODO(M4): surface this in the HUD instead of the console.
        console.log(
          `ได้ทองระหว่างออฟไลน์ +${state.gold - goldBefore} ` +
            `(${Math.round(offlineSeconds)}s${offlineCapped ? ", capped" : ""}, ` +
            `simulated ${ran}/${totalOfflineSteps} steps)`,
        );
      }

      // Don't init Pixi against a 0x0 mount (mobile aspect-ratio/flex reflow can
      // report zero for the first frame or two).
      await waitForNonZeroSize(arenaEl);
      if (cancelled) return;

      await renderer.create(arenaEl);
      if (cancelled) {
        renderer.destroy();
        return;
      }

      autosaveTimer = setInterval(autosave, AUTOSAVE_INTERVAL_MS);
      document.addEventListener("visibilitychange", onVisibility);

      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    };

    // Surface any boot failure instead of letting `void boot()` swallow the
    // rejection (which previously left the loop unstarted and the whole HUD
    // frozen at store defaults with no error anywhere).
    boot().catch((err: unknown) => {
      if (cancelled) return;
      console.error("[GameClient] boot failed:", err);
      showFatalError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (autosaveTimer) clearInterval(autosaveTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      errorEl?.remove();
      errorEl = null;
      renderer.destroy();
    };
  }, []);

  return <GameHud ref={arenaRef} />;
}
