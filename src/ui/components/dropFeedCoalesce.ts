/**
 * Pure coalescing logic for the arena-corner drop feed (Wave 3 "จัดระเบียบ
 * DropFeed" — owner goal "ไม่รก แต่รู้ว่าได้ของ"). Consumes the SAME
 * `dropFeed`/`stoneFeed` store entries `DropFeed.tsx` already reads (no new
 * push pipeline, no store change) but folds the stream of common/rare item
 * drops + stone pickups into a max-3-visible stack:
 *
 *  - consecutive stone pickups merge into ONE pill with a running qty
 *    (a fresh `id` is issued on merge so the pill's React key changes —
 *    `DropFeed.tsx` keys each pill's dismiss-timer `useEffect` off `id`, so a
 *    new id naturally remounts the pill and restarts its timer);
 *  - once the stack is full, a new arrival evicts the OLDEST visible pill and
 *    bumps an "+N" overflow counter — displayed on the new top (the
 *    oldest-remaining) pill only;
 *  - the counter resets to 0 once the stack empties out (a quiet moment).
 *
 * Epic entries never reach this helper — they keep the original fixed
 * top-center beat in `DropFeed.tsx`.
 */

import type { ItemRarity } from "@/engine";
import type { DropFeedEntry } from "@/ui/store/gameStore";

/** One incoming feed event — pre-filtered by the caller to non-epic items +
 * all stone pickups (epic keeps the old top-center toast, uncoalesced). */
export type CoalesceIncoming =
  | { kind: "item"; id: string; templateId: string; rarity: ItemRarity }
  | { kind: "stone"; id: string; qty: number };

/** A rendered pill. Same shape as `CoalesceIncoming` — a stone pill's `qty`
 * and `id` mutate in place across merges, an item pill is immutable. */
export type CoalesceVisible =
  | { kind: "item"; id: string; templateId: string; rarity: ItemRarity }
  | { kind: "stone"; id: string; qty: number };

export interface CoalesceState {
  /** Oldest first, newest last — renders bottom-up ("newest at the bottom"). */
  visible: CoalesceVisible[];
  /** Cumulative hidden/replaced count since the stack last emptied out. */
  overflow: number;
}

/** Max simultaneously-visible pills in the arena corner. */
export const DROP_FEED_VISIBLE_CAP = 3;

export const EMPTY_COALESCE_STATE: CoalesceState = { visible: [], overflow: 0 };

/** Fold ONE incoming entry into the visible stack. Pure: same
 * `(state, incoming)` always produces the same next state. */
export function coalesceDropFeed(
  state: CoalesceState,
  incoming: CoalesceIncoming,
): CoalesceState {
  const { visible } = state;

  // Consecutive stones merge into the newest (bottom) pill instead of
  // pushing a new one.
  if (incoming.kind === "stone" && visible.length > 0) {
    const newest = visible[visible.length - 1];
    if (newest.kind === "stone") {
      const merged: CoalesceVisible = {
        kind: "stone",
        id: incoming.id,
        qty: newest.qty + incoming.qty,
      };
      return { ...state, visible: [...visible.slice(0, -1), merged] };
    }
  }

  if (visible.length < DROP_FEED_VISIBLE_CAP) {
    return { ...state, visible: [...visible, incoming] };
  }

  // Capped: the newest arrival evicts the oldest visible pill; the overflow
  // counter (shown on the new top pill) accrues by one.
  const [, ...rest] = visible;
  return { visible: [...rest, incoming], overflow: state.overflow + 1 };
}

/** Remove a dismissed pill by id (its own display timer fired). Resets
 * `overflow` to 0 once the stack empties — a quiet moment starts it fresh. */
export function dismissCoalesced(state: CoalesceState, id: string): CoalesceState {
  const visible = state.visible.filter((v) => v.id !== id);
  return { visible, overflow: visible.length === 0 ? 0 : state.overflow };
}

/** Split raw `dropFeed` store entries into the epic subset (kept at the
 * original fixed top-center beat, uncoalesced — the discovery moment stays
 * special) and the common/rare subset that feeds `coalesceDropFeed` via the
 * arena-corner stack. */
export function partitionDropFeed(dropFeed: DropFeedEntry[]): {
  epic: DropFeedEntry[];
  coalescable: DropFeedEntry[];
} {
  const epic = dropFeed.filter((e) => e.rarity === "epic");
  const coalescable = dropFeed.filter((e) => e.rarity !== "epic");
  return { epic, coalescable };
}
