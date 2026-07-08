/**
 * M8 party Wave 3 "ตัวบอกสถานะปาร์ตี้" (docs/ghost-presence-design.md) — pure helpers
 * for the network-quality HUD chip's instrumentation math. Owned/called by
 * `GameClient.tsx`'s frame loop; kept here (same split as `cohortWallet.ts`/
 * `cohortProgress.ts`) so the smoothing/derivation logic is unit-testable without a real
 * socket or a `CohortTurnEngine` instance.
 */

/** EMA-smooth an RTT sample (ms). `prev === null` seeds the average with the first
 *  sample outright — no slow ramp-up from 0 on the very first pong. */
export function emaRtt(prev: number | null, sampleMs: number, alpha = 0.3): number {
  if (prev === null) return sampleMs;
  return prev + (sampleMs - prev) * alpha;
}

/** Minimal shape `pickWaitingSlot` needs from a per-member row — a structural subset of
 *  `CohortNetMember` (see `gameStore.ts`) so this module never imports the store. */
export interface LagRow {
  slot: number;
  lagTurns: number;
}

/** While the cohort is `waiting` (the scheduler stalled on a lane), pick the laggiest
 *  member's ticket slot to highlight in the chip — `null` when not waiting, or when
 *  there's nobody to blame (e.g. a stall that resolved the same tick it's read). */
export function pickWaitingSlot(waiting: boolean, members: readonly LagRow[]): number | null {
  if (!waiting || members.length === 0) return null;
  let best = members[0];
  for (const m of members) if (m.lagTurns > best.lagTurns) best = m;
  return best.slot;
}
