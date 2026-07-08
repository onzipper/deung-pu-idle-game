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
 * IN the window's boss zone ("activeHere"), and the LIVE engine state doesn't
 * already BLOCK a respawn for this window: a boss is currently `active`, or this
 * window was `defeated`. A NON-defeated despawn (fled the zone) no longer blocks —
 * re-entry re-queues the spawn so the boss re-engages within its window (owner
 * live bug 2, 2026-07-08). `live` is `state.worldBoss` trimmed to
 * `{ windowId, active, defeated }` (or null when dormant). This mirrors the
 * engine's own `trySpawnWorldBoss` idempotency guard (`wb.active || (wb.windowId
 * === windowId && wb.defeated)`), so a repeat call before the live state catches
 * up is still a safe no-op there too — this predicate is purely a "don't bother
 * queueing" cheap-path, not the actual dedupe authority.
 */
export function shouldQueueWorldBossSpawn(
  phase: WorldBossPhase,
  status: WorldBossStatus,
  live: { windowId: number; active: boolean; defeated: boolean } | null,
): boolean {
  const blocked =
    live !== null && live.windowId === phase.windowId && (live.active || live.defeated);
  return phase.phase === "active" && status.kind === "activeHere" && !blocked;
}

// ── SHARED-HP client driver (M8.6) — pure decision helpers ──────────────────────────
//
// `worldBossDamageDealt(state)` is the SHARED sim's cumulative total: in a cohort every
// member's client reads the IDENTICAL number (lockstep), so if every member posted their
// own watermark delta the server pool would take N× damage for one shared kill. Only the
// AUTHORITY (lowest cohort slot — solo is trivially its own authority) runs the PERIODIC
// full-delta report (`authorityReportDelta`); every OTHER member sends exactly ONE tiny
// participation ping the first time the shared total turns positive for a window
// (`shouldSendParticipationPing`) so a `WorldBossDamage` row exists for THEIR character
// too (the claim's participation gate), without duplicating the decrement. Non-authority
// members instead poll the read-only state endpoint on the same cadence to keep their
// local render's hp current (`shouldPollHp`) — they have no post response of their own to
// ride. GameClient owns the actual watermark/timer bookkeeping (closures, like
// `lastWorldBossStatus`); these are pure predicates over already-computed inputs.

/** The AUTHORITY's periodic report delta: positive damage above `watermark` iff the
 * cadence has elapsed since the last post. Returns 0 when there's nothing to post
 * (caller should skip the POST entirely on 0). */
export function authorityReportDelta(
  totalDamage: number,
  watermark: number,
  msSinceLastPost: number,
  cadenceMs: number,
): number {
  const delta = totalDamage - watermark;
  if (delta <= 0) return 0;
  return msSinceLastPost >= cadenceMs ? delta : 0;
}

/** A non-authority member's ONE-SHOT participation ping: true exactly once per window —
 * the first frame the shared total turns positive. `pingedWindowId` is the caller's own
 * "already pinged this window" latch (set BEFORE the request resolves, so a slow
 * response — or a retry after a failure — can't double-fire within the same window). */
export function shouldSendParticipationPing(
  totalDamage: number,
  windowId: number,
  pingedWindowId: number | null,
): boolean {
  return totalDamage > 0 && pingedWindowId !== windowId;
}

/** A non-authority member's own hp-poll cadence (keeps their local render in sync since
 * they never see a post response). Same shape as `authorityReportDelta`'s cadence gate. */
export function shouldPollHp(msSinceLastPoll: number, cadenceMs: number): boolean {
  return msSinceLastPoll >= cadenceMs;
}
