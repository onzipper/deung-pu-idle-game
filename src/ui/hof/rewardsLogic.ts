/**
 * HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — small
 * pure decision helpers factored out of `ChampionsSection.tsx` /
 * `HallOfFamePanel.tsx` / `components/settings/TitleSection.tsx` so they're
 * headlessly testable (no `@testing-library` in this repo — every UI-adjacent
 * test here is pure-logic, same convention as `ui/hof/format.ts`/`query.ts`
 * and `ui/worldBoss/schedule.ts`). No React/DOM/fetch.
 */

import type { HofMyTitle } from "./rewardsTypes";

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
