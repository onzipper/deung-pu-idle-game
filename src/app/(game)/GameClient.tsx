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
 *      runs `step()` that many times,
 *   4. draws the resulting state with the (one-way, read-only) `GameRenderer`,
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
  bossHint,
  createAccumulator,
  drainAccumulator,
  initGameState,
  step,
  upgradeCost,
  type FrameInput,
  type GameState,
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

  useEffect(() => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return;

    // Fresh per mount — a fixed seed would also be fine here; the engine
    // itself stays pure either way. Save/load (M3) will pass a loaded
    // `SaveData` as the second arg instead of starting cold.
    const state = initGameState(Date.now() >>> 0);
    const renderer = new GameRenderer();
    const acc = createAccumulator();

    let rafId = 0;
    let lastTime = performance.now();
    let uiSyncAccum = 0;
    let cancelled = false;

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

      const steps = drainAccumulator(acc, elapsed, store.speed);
      for (let i = 0; i < steps; i++) {
        step(state, i === 0 ? firstInput : {});
      }

      renderer.draw(state);

      uiSyncAccum += elapsed;
      if (uiSyncAccum >= UI_SYNC_INTERVAL) {
        uiSyncAccum -= UI_SYNC_INTERVAL;
        store.syncFromEngine(buildSnapshot(state));
      }
    }

    // Pixi init is async; only start the loop once it resolves, and guard
    // against the effect having already been cleaned up in the meantime
    // (React Strict Mode's dev-mode mount/unmount/mount) by tearing the
    // renderer back down instead of leaking an orphaned canvas.
    void renderer.create(arenaEl).then(() => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      renderer.destroy();
    };
  }, []);

  return <GameHud ref={arenaRef} />;
}
