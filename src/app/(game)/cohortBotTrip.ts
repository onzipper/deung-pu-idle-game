/**
 * M8 party — "the bot still works while partied" (owner 2026-07-08: "ไม่ว่าจะเล่นเดี่ยว
 * หรือปาร์ตี้ บอทยังคงต้องทำงานเหมือนเดิม").
 *
 * The shared cohort `GameState` must never travel on one member's automation decision
 * (commit 8822f54 correctly suppresses the engine from INITIATING a town trip whenever
 * `heroes.length > 1`). But the owner wants restock/sell trips to still happen for a
 * partied bot — the fix is the SAME shape as the existing manual zone-change escape
 * hatch (`buildFrameInput.ts`'s `hasZoneChangeIntent` → `GameClient`'s `collapseToSolo()`):
 * when MY hero's bot would want a trip, MY client alone leaves the cohort, the now-solo
 * engine's own `updateBots` runs the trip completely normally (walk to town, chores, walk
 * back to the farm frontier), and the existing zone-beat protocol re-forms the cohort the
 * moment I'm standing back in the same zone as my friends (identical mechanism to walking
 * INTO a friend's zone — no new re-form logic needed).
 *
 * This module is the PURE "should I leave right now" decision only — the actual
 * restock/sell-trip predicate itself is `wantsBotTownTrip` (`@/engine`, mirrors
 * `systems/bots.ts`'s exact hpShort/mpShort-vs-target + spendable-gold + sell-trip-cap
 * arithmetic byte-for-byte). Kept in its own module (no DOM/React/Pixi/relay import) so
 * it's headlessly unit-testable like `buildFrameInput.ts` / `cohortWallet.ts`.
 */

/** Debounce so a borderline condition (e.g. gold hovering right at the affordability
 * line) can't flap the cohort — leave, rejoin, leave again — every frame. Deliberately
 * generous: a restock/sell trip that's a FEW seconds late costs nothing while farming. */
export const BOT_TRIP_LEAVE_DEBOUNCE_MS = 20_000;

export interface ShouldLeaveCohortForBotTripInput {
  /** Whether the lockstep cohort is currently active (dormant otherwise — solo already
   * runs its own bot trips through the ordinary engine path, no leave needed). */
  cohortActive: boolean;
  /** This frame's `wantsBotTownTrip(...).needRestock` result (MY virtualized wallet). */
  needRestock: boolean;
  /** This frame's `wantsBotTownTrip(...).needSell` result (MY virtualized wallet). */
  needSell: boolean;
  /** Monotonic "now" (the rAF timestamp `frame(now)` already carries — never `Date.now()`,
   * matching every other in-frame timing check in `GameClient.tsx`). */
  nowMs: number;
  /** The last time this decision fired `true` (null = never yet, or reset on rejoin). */
  lastLeaveAtMs: number | null;
  /** `BOT_TRIP_LEAVE_DEBOUNCE_MS` by default; parameterized for tests. */
  debounceMs: number;
}

/**
 * True exactly when MY client should call `collapseToSolo()` THIS frame to let my
 * hero's bot run its restock/sell trip. Solo (not in a cohort), nothing wanted, or
 * still inside the debounce window since the last leave ⇒ false.
 */
export function shouldLeaveCohortForBotTrip(input: ShouldLeaveCohortForBotTripInput): boolean {
  if (!input.cohortActive) return false;
  if (!input.needRestock && !input.needSell) return false;
  if (input.lastLeaveAtMs !== null && input.nowMs - input.lastLeaveAtMs < input.debounceMs) return false;
  return true;
}
