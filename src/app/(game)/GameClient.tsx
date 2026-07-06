"use client";

/**
 * The game-loop host: the seam where the pure engine, the Pixi renderer, and
 * the React HUD meet.
 *
 * Owns the live `GameState` and the render `Application` as plain closures
 * inside a single `useEffect` (never React state — see `CLAUDE.md`'s no
 * per-frame-state-in-React rule). Each rAF tick:
 *   1. copies the UI-owned `autoCast`/`autoAllocate`/`autoReturn`/auto-potion/
 *      `soundMuted` flags off the Zustand store onto the engine state /
 *      `AudioController`,
 *   2. drains the one-shot player-intent queue (`drainPendingInput`) exactly
 *      once and hands it to the FIRST fixed sub-step of the frame,
 *   2b. shapes this frame's real elapsed seconds through `TimeDirector`
 *      (`./timeDirector.ts`) using LAST frame's events, for hit-stop/slow-mo
 *      (M4 juice) — ONLY the accumulator's input is shaped; the renderer,
 *      audio, and the ~10Hz UI-sync below all keep using the real elapsed
 *      time so fx/SFX/HUD stay snappy even while the sim is frozen/slowed,
 *   3. asks the fixed-timestep accumulator how many `FIXED_DT` sub-steps to
 *      run and runs `step()` that many times, concatenating each sub-step's
 *      `state.events` into one `frameEvents` array (M4 juice feed — the buffer
 *      is cleared at the START of every step(), so a multi-sub-step frame
 *      must collect across all of them). The player-facing 1x/2x/3x speed
 *      selector was removed (M6.7) — the accumulator is always drained at a
 *      fixed multiplier of 1 sub-step per real frame now; `drainAccumulator`
 *      itself still takes a speed argument (used by the sim/balance harness
 *      and engine tests), it's just hardcoded to `1` from this integration seam,
 *   4. draws the resulting state + `frameEvents` with the (one-way,
 *      read-only) `GameRenderer`, which reacts to them on its `fx` layer, then
 *      hands the same `frameEvents` to the `AudioController` (`render/audio`)
 *      for SFX — same one-way, event-driven shape as the fx layer,
 *   5. at the throttled `CONFIG.uiSyncHz` cadence, pushes a HUD-only snapshot
 *      back into the store via `syncFromEngine`.
 *
 * No game logic lives here — this only pumps input -> step -> draw -> snapshot.
 * Save/load (M3) hooks in at two points: pass a loaded `SaveData` into
 * `initGameState(seed, save)` on mount, and periodically/on-unload serialize
 * the relevant `GameState` fields back out.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import {
  CONFIG,
  FIXED_DT,
  ITEM_TEMPLATES,
  SIGNATURE_SKILL,
  bossHint,
  canEvolveHero,
  canUseConsumable,
  classChangeQuestFor,
  combatPower,
  createAccumulator,
  drainAccumulator,
  initGameState,
  isClassChangeQuestOffered,
  learnedSkills,
  migrate,
  primaryStat,
  shopPriceAt,
  shopStageOf,
  skillCdOf,
  step,
  toSaveData,
  unlockedAutoSlotCount,
  worldNav,
  type FrameInput,
  type GameEvent,
  type GameState,
  type Hero,
  type SaveData,
} from "@/engine";
import { AudioController } from "@/render/audio";
import { GameRenderer } from "@/render/GameRenderer";
import { GameHud } from "@/ui/components/GameHud";
import { takeBatch, type ClaimBufferEntry } from "@/ui/gear/claimBuffer";
import { postClaimBatch } from "@/ui/gear/api";
import { toInventoryItem } from "@/ui/gear/types";
import type { ClaimItemResultWire, ItemInstanceWire } from "@/ui/gear/types";
import {
  useGameStore,
  type EngineSnapshot,
  type HeroQuestSummary,
  type HeroSummary,
  type ShopSummary,
  type SkillSummary,
} from "@/ui/store/gameStore";
import { TimeDirector } from "./timeDirector";

/** Mirrors `server/items.ts`'s `MAX_CLAIM_BATCH` (server zone, not importable
 * from here — the cap is a plain contract number, duplicated deliberately
 * rather than reached into `@/server/**`). A buffer bigger than this flushes
 * across multiple autosave-cadence ticks instead of being truncated. */
const MAX_CLAIM_BATCH = 64;

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

/** Precompute the learned-skill kit's display state (M5 skill framework v2). */
function buildSkillSummaries(h: Hero): SkillSummary[] {
  return learnedSkills(h).map((def): SkillSummary => {
    const cd = skillCdOf(h, def.id);
    const affordable = h.mana >= def.cost;
    const autoSlot = h.autoSlots.indexOf(def.id);
    return {
      id: def.id,
      cd,
      maxCd: def.cd,
      cost: def.cost,
      ready: cd <= 0 && affordable && !h.dead,
      affordable,
      autoSlot: autoSlot >= 0 ? autoSlot : null,
    };
  });
}

/**
 * Precompute the class-change quest affordance state (M5 task 5). Returns null
 * when there's nothing quest-related to show (tier 2, or below the level gate with
 * no active quest — the bar shows the evolved badge / locked hint from tier/level).
 */
function buildQuestSummary(h: Hero): HeroQuestSummary | null {
  if (h.tier === 2) return null;
  const offered = isClassChangeQuestOffered(h);
  const q = h.quest;
  if (!offered && !q) return null; // below the level gate — no affordance yet
  const def = classChangeQuestFor(h.cls);
  const killIdx = def.objectives.findIndex((o) => o.type === "kill");
  const bossIdx = def.objectives.findIndex((o) => o.type === "killBoss");
  const kills = killIdx >= 0 ? (q?.progress[killIdx] ?? 0) : 0;
  const killGoal = killIdx >= 0 ? def.objectives[killIdx].count : 0;
  const bossDone =
    bossIdx >= 0 && (q?.progress[bossIdx] ?? 0) >= def.objectives[bossIdx].count;
  const accepted = q?.accepted ?? false;
  const complete =
    accepted && def.objectives.every((o, i) => (q?.progress[i] ?? 0) >= o.count);
  return { offered, accepted, complete, kills, killGoal, bossDone };
}

function buildSnapshot(state: GameState): EngineSnapshot {
  const heroes: HeroSummary[] = state.heroes.map((h) => {
    const atLevelCap = h.level >= CONFIG.leveling.levelCap;
    // Precompute the 0..1 progress float HERE (the one place the xp-curve
    // math is allowed to run) so the throttled store only ever carries a
    // display-ready number, never raw xp/`xpToLevel()` (see HeroSummary's
    // doc comment).
    const xpProgress = atLevelCap
      ? 1
      : Math.max(0, Math.min(1, h.xp / CONFIG.leveling.xpToLevel(h.level)));
    return {
      cls: h.cls,
      hp: h.hp,
      maxHp: h.maxHp,
      // Signature skill cooldown (onboarding's "you cast a skill" detector).
      skillCd: skillCdOf(h, SIGNATURE_SKILL[h.cls]),
      mana: h.mana,
      maxMana: h.maxMana,
      skills: buildSkillSummaries(h),
      autoSlots: [...h.autoSlots],
      unlockedSlots: unlockedAutoSlotCount(h.level),
      dead: h.dead,
      level: h.level,
      xpProgress,
      atLevelCap,
      tier: h.tier,
      // Pure display reads (M5 evolution) — the same rule/read-path
      // `xpProgress` uses: engine helpers compute it, the store just carries
      // the display-ready result.
      canEvolve: canEvolveHero(state, h),
      quest: buildQuestSummary(h),
      // M5 "Base stats" — same one-way display read-path: engine helpers compute
      // it, the store just carries the display-ready result.
      statPoints: h.statPoints,
      stats: { ...h.stats },
      primaryStat: primaryStat(h.cls),
      combatPower: combatPower(h),
      // M7 Gear & Drops: the sim's own applied loadout (see `HeroSummary.equipped`
      // doc — distinct from, but kept in sync with, the DB-hydrated `inventory`
      // store slice). Shallow-copied like `stats` above (never alias engine state).
      equipped: { ...h.equipped },
    };
  });

  // World position + walk-arrow affordances (M6). Precompute the display-ready
  // neighbor state here (the one place the engine `worldNav` read runs) so the
  // throttled store carries only plain data.
  const nav = worldNav(state);
  const neighbor = (n: typeof nav.left) =>
    n
      ? {
          mapId: n.zone.mapId,
          zoneIdx: n.zone.zoneIdx,
          kind: n.zone.kind,
          unlocked: n.unlocked,
        }
      : null;

  // NPC shop + consumables (M6). Prices scale by farming depth (shopStageOf), not
  // the town's stage; readiness is the precomputed quick-use guard.
  const shopStage = shopStageOf(state);
  const shop: ShopSummary = {
    counts: { ...state.consumables },
    prices: {
      hpPotion: shopPriceAt("hpPotion", shopStage),
      manaPotion: shopPriceAt("manaPotion", shopStage),
      returnScroll: shopPriceAt("returnScroll", shopStage),
    },
    stackCap: CONFIG.shop.stackCap,
    ready: {
      hpPotion: canUseConsumable(state, "hpPotion"),
      manaPotion: canUseConsumable(state, "manaPotion"),
    },
  };

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
    world: {
      mapId: nav.current.mapId,
      zoneIdx: nav.current.zoneIdx,
      kind: nav.current.kind,
      stage: nav.current.stage,
      traveling: nav.traveling,
      left: neighbor(nav.left),
      right: neighbor(nav.right),
    },
    shop,
  };
}

export function GameClient() {
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const t = useTranslations("common");
  // Captured in a ref (not read directly inside the mount-only effect below)
  // so a mid-session locale switch (`router.refresh()` — no remount, see
  // `LocaleSwitch.tsx`) still updates the string this rare fatal-error path
  // would show, without re-running the boot/rAF-loop effect itself.
  const tRef = useRef(t);
  tRef.current = t;

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
    const audio = new AudioController();
    const acc = createAccumulator();
    const timeDirector = new TimeDirector();

    let rafId = 0;
    let lastTime = performance.now();
    let uiSyncAccum = 0;
    let cancelled = false;
    // Previous rAF frame's event batch — TimeDirector reacts to these (a
    // one-frame trigger latency is expected/fine; see timeDirector.ts).
    let lastFrameEvents: GameEvent[] = [];
    let autosaveTimer: ReturnType<typeof setInterval> | undefined;
    // A non-React DOM node we may append to the (React-owned) arena div to show
    // a fatal init error; tracked so cleanup can remove it before a remount.
    let errorEl: HTMLElement | null = null;

    // ---- M7 Gear & Drops: drop-claim buffer (closure state, NOT React/Zustand
    // — same "never per-frame state in React" rule as engine state itself).
    // `itemDrop` events are collected here every frame and flushed as a batch
    // on the autosave cadence + tab-hide (see `flushClaims`/`onVisibility`). ----
    let pendingClaims: ClaimBufferEntry[] = [];
    let claimInFlight = false;

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
      errorEl.textContent = tRef.current("fatalError", { reason });
    }

    function frame(now: number) {
      rafId = requestAnimationFrame(frame);

      const elapsed = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
      lastTime = now;

      const store = useGameStore.getState();

      // UI-owned flags the engine reads directly (not part of FrameInput).
      state.autoCast = store.autoCast;
      state.autoAllocate = store.autoAllocate;
      state.autoReturn = store.autoReturn;
      // Auto-use potion toggles + thresholds (M6), same UI-owned pattern.
      state.autoHpPotion = store.autoHpPotion;
      state.autoManaPotion = store.autoManaPotion;
      state.autoHpThreshold = store.autoHpThreshold;
      state.autoManaThreshold = store.autoManaThreshold;
      // UI-owned sound preference — applied to the audio module every frame,
      // same pattern (never queued through FrameInput; it isn't sim state).
      audio.setMuted(store.soundMuted);

      // Drain the one-shot intent queue exactly once per real frame; only the
      // first fixed sub-step of this frame gets it (remaining sub-steps, if
      // the speed multiplier produces more than one, get an empty input).
      const pending = store.drainPendingInput();
      const firstInput: FrameInput = {
        castSkills: pending.castSkills.length ? pending.castSkills : undefined,
        setAutoSlots: pending.setAutoSlots.length ? pending.setAutoSlots : undefined,
        challengeBoss: pending.challengeBoss || undefined,
        advanceStage: pending.advanceStage || undefined,
        walkToZone: pending.walkToZone ?? undefined,
        evolveHero: pending.evolveHero ?? undefined,
        acceptQuest: pending.acceptQuest ?? undefined,
        allocateStat: pending.allocateStat ?? undefined,
        buyShopItem: pending.buyShopItem ?? undefined,
        useConsumable: pending.useConsumable ?? undefined,
        useReturnScroll: pending.useReturnScroll || undefined,
        equip: pending.equip ?? undefined,
      };

      // Shape ONLY the accumulator's input (hit-stop/slow-mo, M4 juice) off of
      // LAST frame's events — real `elapsed` still drives the renderer, audio,
      // and UI-sync below so fx/SFX/HUD never stutter, even mid-freeze.
      const simElapsed = timeDirector.shape(elapsed, lastFrameEvents);

      // `state.events` is cleared at the START of each step() and holds only
      // that sub-step's events; a stalled/dropped rAF frame can still produce
      // more than one fixed sub-step here (via `simElapsed`), so we must
      // collect across ALL of them before draw() (see
      // engine/state/events.ts's collection contract). The speed multiplier
      // itself is hardcoded to 1 — the player-facing 1x/2x/3x selector was
      // removed (M6.7); `drainAccumulator`'s speed parameter still exists for
      // the sim/balance harness and engine tests.
      const steps = drainAccumulator(acc, simElapsed, 1);
      const frameEvents: GameEvent[] = [];
      for (let i = 0; i < steps; i++) {
        step(state, i === 0 ? firstInput : {});
        frameEvents.push(...state.events);
      }

      renderer.draw(state, frameEvents);
      if (frameEvents.length) audio.consumeEvents(frameEvents);

      // M7 Gear & Drops: buffer every `itemDrop` this frame for the batched
      // server claim (flushed on the autosave cadence / tab-hide below). The
      // engine's roll is already deterministic + monotonic (rollId), so this
      // is a plain append — no on-the-spot dedup needed in the common case.
      for (const ev of frameEvents) {
        if (ev.type === "itemDrop") {
          pendingClaims.push({
            rollId: ev.rollId,
            templateId: ev.templateId,
            stage: state.stage,
          });
        }
      }

      uiSyncAccum += elapsed;
      if (uiSyncAccum >= UI_SYNC_INTERVAL) {
        uiSyncAccum -= UI_SYNC_INTERVAL;
        store.syncFromEngine(buildSnapshot(state));
      }

      // Feeds TimeDirector's trigger scan on the NEXT rAF frame (one-frame
      // latency by design — see timeDirector.ts's class doc).
      lastFrameEvents = frameEvents;
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
      // Same cadence as the save POST (see the drop-claim flush's own doc below).
      flushClaims();
    }

    // ---- M7 Gear & Drops: batched drop-claim flush (same cadence as autosave,
    // see the call site below). Fire-and-forget; on a network failure the batch
    // is RE-QUEUED (claims are server-side idempotent via claimKey — a retry
    // can never double-mint, see `docs/persistence-m7.md`), so nothing here can
    // lose a drop except the tab-hide beacon path (accepted v1 tradeoff — noted
    // on `onVisibility` below and in the ui/README). One flush in flight at a
    // time so two overlapping timers can't race the same buffer. ----
    function applyClaimResults(results: ClaimItemResultWire[]): void {
      const minted: ItemInstanceWire[] = [];
      const rejectedCounts: Partial<Record<string, number>> = {};
      for (const r of results) {
        if (r.status === "rejected") {
          rejectedCounts[r.reason] = (rejectedCounts[r.reason] ?? 0) + 1;
          continue;
        }
        minted.push(r.item);
        if (r.status === "minted") {
          const template = ITEM_TEMPLATES[r.item.templateId];
          useGameStore
            .getState()
            .pushDropFeed(r.item.templateId, template?.rarity ?? "common");
        }
      }
      if (minted.length) useGameStore.getState().mergeInventory(minted);
      if (Object.keys(rejectedCounts).length) {
        console.warn("[GameClient] drop-claim rejections:", rejectedCounts);
      }
    }

    function flushClaims(): void {
      if (claimInFlight || pendingClaims.length === 0) return;
      const { batch, remaining } = takeBatch(pendingClaims, MAX_CLAIM_BATCH);
      pendingClaims = remaining;
      claimInFlight = true;
      void postClaimBatch(batch)
        .then((res) => {
          if (res) applyClaimResults(res.results);
          else pendingClaims = [...batch, ...pendingClaims]; // network failure — retry next cadence
        })
        .finally(() => {
          claimInFlight = false;
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

      // Best-effort drop-claim flush via the same fire-and-forget beacon
      // mechanism. UNLIKE the save beacon, a lost claim beacon here is an
      // accepted v1 loss (no response to merge into the inventory slice even
      // if it lands) — documented tradeoff, see this function's doc comment.
      if (pendingClaims.length > 0) {
        const claimBlob = new Blob(
          [JSON.stringify({ items: pendingClaims.slice(0, MAX_CLAIM_BATCH) })],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/items/claim", claimBlob);
        pendingClaims = [];
      }
    }

    // Browsers block audio output until a real user gesture — resume() is
    // idempotent/cheap, so just call it on every pointerdown inside the arena
    // rather than trying to detect "the first one" ourselves.
    function onPointerDown(): void {
      audio.resume();
    }
    arenaEl.addEventListener("pointerdown", onPointerDown);

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
            // M7 boot payload (server: src/app/api/save/route.ts GET) — always
            // present (possibly empty arrays/nulls pre-character).
            inventory?: ItemInstanceWire[];
            equipped?: { weapon: string | null; armor: string | null };
          };
          // Server already migrated; pass through migrate() again defensively —
          // never trust a received save's shape/version (CLAUDE.md rule).
          if (json.save) loaded = migrate(json.save);
          if (json.offline) {
            offlineSeconds = json.offline.creditedSeconds;
            offlineCapped = json.offline.capped;
          }
          // M7: the DB `ItemInstance` ledger is AUTHORITATIVE over the save
          // blob's own `equipped` cache (precedence documented at the API) —
          // overwrite it BEFORE `initGameState` derives max HP from it below.
          if (loaded && json.equipped) loaded.equipped = { ...json.equipped };
          // Seed the inventory store slice straight from the boot payload —
          // this is the ONLY normal hydration path (InventoryPanel never
          // fetches on its own mount, only on an equip-failure resync).
          if (json.inventory) {
            useGameStore.getState().setInventory(json.inventory.map(toInventoryItem));
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
        // Offline idle FORCES auto-return (M6): a hero dead at the snapshot must
        // respawn + walk back to farm during the replay so idle earnings never
        // stall in town (regardless of the live UI toggle).
        state.autoReturn = true;
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
      arenaEl.removeEventListener("pointerdown", onPointerDown);
      errorEl?.remove();
      errorEl = null;
      renderer.destroy();
      audio.destroy();
    };
  }, []);

  return <GameHud ref={arenaRef} />;
}
