/**
 * World boss "เสี่ยจ๋อง" (hourly world boss) — pure schedule-derivation + display
 * helpers, shared by `GameClient.tsx` (drives the store's `worldBossStatus` slice
 * + the `spawnWorldBoss` intent injection off these) and `WorldBossBanner.tsx`
 * (renders the countdown text). No React/fetch/engine-state mutation here —
 * everything is a pure function of already-computed inputs (the engine's own
 * `worldBossPhaseAt`/`worldBossLocationFor` reads + the player's current
 * location), so this is headlessly testable without mounting GameClient
 * (`__tests__/schedule.test.ts`).
 */

import { worldBossLocationFor, type WorldBossPhase } from "@/engine";
import type { WorldBossStatus } from "@/ui/store/gameStore";

/** mm:ss countdown display — floors at "0:00" (never negative), rounds to the
 *  nearest second. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Derive the display-ready HUD status from the engine's pure schedule read
 * (`worldBossPhaseAt(nowMs)`) + the player's CURRENT world location. `"activeHere"`
 * is the "found it!" state — the window's chosen farm zone (`worldBossLocationFor`)
 * matches `location`. `secondsLeft` is a whole-second ceiling (never 0 while the
 * phase is genuinely pre/active), which also gives the store push its ~1Hz cadence
 * for free (see `sameWorldBossStatus`'s doc).
 */
export function deriveWorldBossStatus(
  phase: WorldBossPhase,
  location: { mapId: string; zoneIdx: number },
): WorldBossStatus {
  if (phase.phase === "idle") return { kind: "idle" };
  if (phase.phase === "pre") {
    return { kind: "pre", secondsLeft: Math.ceil(phase.msToSpawn / 1000) };
  }
  const secondsLeft = Math.ceil(phase.msRemaining / 1000);
  const loc = worldBossLocationFor(phase.windowId);
  const here = loc !== null && loc.mapId === location.mapId && loc.zoneIdx === location.zoneIdx;
  return here ? { kind: "activeHere", secondsLeft } : { kind: "active", secondsLeft };
}

/**
 * Structural equality for the small `WorldBossStatus` union — used to gate
 * `GameClient.tsx`'s store push to actual TRANSITIONS only (never a per-frame
 * write). Comparing `secondsLeft` too means the push naturally happens once per
 * whole-second tick while pre/active (the ~1Hz cadence the banner wants) without
 * needing a separate throttle accumulator.
 */
export function sameWorldBossStatus(a: WorldBossStatus, b: WorldBossStatus): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "idle") return true;
  // `b` shares `a.kind` here (both are one of the three non-idle variants, which
  // all carry `secondsLeft`), so this cast is safe.
  return a.secondsLeft === (b as { secondsLeft: number }).secondsLeft;
}

/**
 * Should `GameClient.tsx` queue a `spawnWorldBoss` intent THIS frame? True
 * exactly when the schedule says "active", the derived status says I'm standing
 * IN the window's boss zone ("activeHere"), and the LIVE engine state hasn't
 * already recorded an entry for this window (spawned/despawned/defeated —
 * `liveWorldBossWindowId` is `state.worldBoss?.windowId ?? null`). This mirrors
 * the engine's own `trySpawnWorldBoss` idempotency guard (`wb.windowId ===
 * windowId || wb.active`), so a repeat call before the live state catches up is
 * still a safe no-op there too — this predicate is purely a "don't bother
 * queueing" cheap-path, not the actual dedupe authority.
 */
export function shouldQueueWorldBossSpawn(
  phase: WorldBossPhase,
  status: WorldBossStatus,
  liveWorldBossWindowId: number | null,
): boolean {
  return (
    phase.phase === "active" &&
    status.kind === "activeHere" &&
    liveWorldBossWindowId !== phase.windowId
  );
}
