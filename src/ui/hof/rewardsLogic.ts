/**
 * HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — small
 * pure decision helpers factored out of `PodiumStrip.tsx` /
 * `HallOfFamePanel.tsx` / `components/settings/TitleSection.tsx` so they're
 * headlessly testable (no `@testing-library` in this repo — every UI-adjacent
 * test here is pure-logic, same convention as `ui/hof/format.ts`/`query.ts`
 * and `ui/worldBoss/schedule.ts`). No React/DOM/fetch.
 */

import { HOF_REWARD_BOARDS, type HofRewardBoard } from "./titles";
import type { HofChampionRow, HofMyTitle, HofUnclaimedAward } from "./rewardsTypes";
import type { HofBoard } from "./types";

export type ClaimState = "idle" | "claiming" | "claimed" | "error";

/** The claim-button state machine's terminal transition after a `POST
 * /api/hof/claim` resolves — `null` (network/parse failure, mirrors
 * `postWorldBossClaim`'s convention) is treated the same as an explicit
 * rejection: both leave the award unclaimed, so the button resets to
 * retry-able rather than getting stuck. */
export function claimStateAfterResult(result: { ok: true } | { ok: false } | null): ClaimState {
  return result && result.ok ? "claimed" : "error";
}

/**
 * Whether a tapped leaderboard `entry` (from the legacy, frozen `/api/hof`
 * board contract, which carries no `characterId`) is the VIEWER'S OWN row —
 * `HallOfFamePanel.tsx` feeds this into `HofProfileModal`'s `isMe` prop so it
 * knows when it may resolve permanent badges for the caller's own
 * `myCharacterId` (see that file's module doc for the full reasoning). Exact,
 * not a heuristic: `me.rank` is the caller's OWN rank on the SAME board query
 * the entry came from, and ranks are unique within a board's top list.
 */
export function isMyEntry(meRank: number | null | undefined, entryRank: number): boolean {
  return meRank != null && meRank === entryRank;
}

export type TitlePickerState =
  | { kind: "hidden" }
  | { kind: "ready"; titles: HofMyTitle[]; displayTitle: string | null };

/**
 * Settings → chosen-title picker's visibility/content. Hidden whenever there
 * is no active character or it holds zero titles this season — a player who
 * never placed top-3 should never see an empty radio list.
 */
export function resolveTitlePickerState(
  me: { titles: HofMyTitle[]; displayTitle: string | null } | null,
): TitlePickerState {
  if (!me || me.titles.length === 0) return { kind: "hidden" };
  return { kind: "ready", titles: me.titles, displayTitle: me.displayTitle };
}

// ── Podium strip (HOF panel redesign) ───────────────────────────────────────
// `PodiumStrip.tsx` renders rank-1 (+ an expandable rank 2-3 reveal) for
// WHICHEVER board is currently selected in `HallOfFamePanel.tsx` — a single
// nav (the board tabs) drives both the podium AND the live list below it,
// replacing the old always-on 2x2 "current champions" grid. All these
// helpers are pure re-keying/lookup logic over the ONE `/api/hof/rewards`
// response (`useHofRewards.ts`'s fetch) — no extra network calls per tab.

const REWARD_BOARD_SET: ReadonlySet<HofBoard> = new Set(HOF_REWARD_BOARDS);

/** The seasonal rewards program only covers 4 of the 5 leaderboards — boss-
 * clear-time has no v1 reward (see `titles.ts`'s `HOF_REWARD_BOARDS` comment).
 * `HofBoard` is a superset of `HofRewardBoard`, so this doubles as the type
 * guard `resolvePodium` needs to index `champions` safely. */
export function isRewardBoard(board: HofBoard): board is HofRewardBoard {
  return REWARD_BOARD_SET.has(board);
}

export type PodiumResolution =
  /** Boss board (no v1 reward) — render NO podium strip at all. */
  | { kind: "none" }
  /** A reward board, but no season has closed yet (server hasn't crowned a
   * first champion of ANY category). */
  | { kind: "noSeason" }
  /** A reward board with a closed season, but zero champion rows for THIS
   * board specifically (defensive — the design doc expects rank 1 to always
   * exist once a season closes, but an empty array should never crash). */
  | { kind: "empty" }
  /** Always exactly 3 fixed slots (podium stage redesign) — `rank1` always
   * exists once a season has closed with at least one row; `rank2`/`rank3`
   * are `null` on a short board (fewer than 3 champions crowned this
   * category) and render as an engraved placeholder, never shifting the
   * layout. Looked up by EXACT rank number (not "whatever's left") so a
   * pathological rows array (e.g. rank1+rank3, no rank2) still slots
   * correctly instead of misplacing rank3 into the rank2 seat. */
  | {
      kind: "ready";
      rank1: HofChampionRow;
      rank2: HofChampionRow | null;
      rank3: HofChampionRow | null;
    };

/**
 * Re-keys the ALREADY-fetched `/api/hof/rewards` response by the currently
 * selected board — `HallOfFamePanel.tsx` calls this on every board switch
 * (no new fetch); `PodiumStrip.tsx` renders purely off the result.
 */
export function resolvePodium(
  rewards: { season: string | null; champions: Record<HofRewardBoard, HofChampionRow[]> } | null,
  board: HofBoard,
): PodiumResolution {
  if (!isRewardBoard(board)) return { kind: "none" };
  if (rewards === null) return { kind: "none" };
  if (rewards.season === null) return { kind: "noSeason" };
  const rows = rewards.champions[board];
  if (!rows || rows.length === 0) return { kind: "empty" };
  const rank1 = rows.find((r) => r.rank === 1) ?? rows[0];
  const rank2 = rows.find((r) => r.rank === 2) ?? null;
  const rank3 = rows.find((r) => r.rank === 3) ?? null;
  return { kind: "ready", rank1, rank2, rank3 };
}

/** Parses the trailing rank number out of a structural title id
 * (`"<board>.<rank>"`, see `titles.ts`) — lets the podium stage place the
 * viewer's own unclaimed-award CTA on the SPECIFIC slot (1/2/3) it belongs
 * to, rather than always anchoring it to one fixed spot regardless of which
 * rank the player actually holds. `null` for an unparseable id (defensive;
 * ids always come from the server's own mint). */
export function rankFromTitleId(titleId: string): number | null {
  const parts = titleId.split(".");
  const rank = Number(parts[parts.length - 1]);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

/** My own unclaimed award for THIS specific board, if any — feeds the claim
 * CTA that lives inside that board's podium strip (item 1 of the redesign:
 * "the claim CTA... stays reachable... in the podium strip of the relevant
 * board"). */
export function resolveMyUnclaimedForBoard(
  awards: readonly HofUnclaimedAward[] | null | undefined,
  board: HofBoard,
): HofUnclaimedAward | null {
  if (!awards) return null;
  return awards.find((a) => a.board === board) ?? null;
}

/** Whether the slim "you have an unclaimed reward" banner (shown above the
 * board tabs, regardless of which board is selected) should render — a
 * player who never opens the board holding their award must still see it. */
export function hasAnyUnclaimedAward(
  me: { unclaimedAwards: readonly HofUnclaimedAward[] } | null | undefined,
): boolean {
  return !!me && me.unclaimedAwards.length > 0;
}

/** Cross-references a live-list row's `charName` against the SAME board's
 * champion rows (from the one rewards fetch) so `RankRow` can show a title
 * under the name when the current top-10 entry happens to also be a crowned
 * champion — reuses `rewards`, never a new request. `null` for boss (no
 * titles minted there) or no match. */
export function titleForCharInBoard(
  rewards: { champions: Record<HofRewardBoard, HofChampionRow[]> } | null,
  board: HofBoard,
  charName: string,
): string | null {
  if (!isRewardBoard(board) || rewards === null) return null;
  const row = rewards.champions[board]?.find((r) => r.charName === charName);
  return row ? row.titleId : null;
}

// ── Live-list loading stability (owner: tab switches must never make the
// panel "ยึดๆ หดๆ" — stretch/shrink) ────────────────────────────────────────

/** Skeleton row count for a board with no cached data yet — matches the
 * board's own top-10 cap so the fixed-height list container never needs more
 * placeholder rows than a real response could ever return. */
export const HOF_SKELETON_ROW_COUNT = 10;

/** Currently a flat constant (every board caps at top-10), factored into its
 * own function so a future per-board cap doesn't need call-site changes. */
export function resolveSkeletonRowCount(): number {
  return HOF_SKELETON_ROW_COUNT;
}

export type BoardFetchDecision<T> =
  /** Cache hit — render the cached data INSTANTLY, no skeleton. The caller
   * still fires a background refetch to swap in fresher data in place. */
  | { kind: "instant"; data: T }
  /** Cache miss — nothing to paint yet, show `rowCount` skeleton rows while
   * the first fetch for this board/filter combo is in flight. */
  | { kind: "skeleton"; rowCount: number };

/** The board-switch loading decision (`HallOfFamePanel.tsx`'s query-keyed
 * session cache): a cache hit never shows a loading skeleton, a cache miss
 * always does. Pure over the cache lookup result so it's testable without a
 * real `Map`/fetch. */
export function resolveBoardFetchDecision<T>(
  cached: T | undefined,
  skeletonRowCount: number,
): BoardFetchDecision<T> {
  if (cached !== undefined) return { kind: "instant", data: cached };
  return { kind: "skeleton", rowCount: skeletonRowCount };
}
