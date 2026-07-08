/**
 * HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — the ONE
 * place a structural title id (`"<board>.<rank>"`, e.g. "level.1", minted by
 * `src/server/hofSeason.ts`'s `titleId()`) is mapped to its localized display
 * string. Every surface that shows a title (HOF panel, friends/party rows,
 * nameplates via the `setHeroSocialBadges` render seam, the settings picker)
 * MUST go through this helper rather than re-deriving the i18n key inline —
 * keeps the 12-id table (4 reward boards × rank 1-3) declared exactly once.
 *
 * Split into a pure id->key mapping (`titleI18nKey`, headlessly testable, no
 * i18n dependency) and a thin `titleLabel` composer that joins it with a
 * translator function — the same "pure core, thin glue" shape the rest of
 * `ui/hof/` already uses (`format.ts`/`query.ts`).
 */

export type HofRewardBoard = "level" | "power" | "gold" | "online";

/** Mirrors `REWARD_BOARDS` in `src/server/hofSeason.ts` (boss-time is
 * excluded from the rewards program per the design doc) — re-declared here
 * rather than imported so this module stays a plain wire-shape consumer, not
 * a server-code import (same "UI never imports server internals" convention
 * as `ui/gear/types.ts`). */
export const HOF_REWARD_BOARDS: readonly HofRewardBoard[] = ["level", "power", "gold", "online"];

const RANKS = [1, 2, 3] as const;

const VALID_TITLE_IDS: ReadonlySet<string> = new Set(
  HOF_REWARD_BOARDS.flatMap((board) => RANKS.map((rank) => `${board}.${rank}`)),
);

/** True for exactly the 12 structural ids the server can ever mint
 * (4 boards × ranks 1-3). Anything else (including a stale/foreign string a
 * client should never trust) is not a real title. */
export function isKnownTitleId(titleId: string): boolean {
  return VALID_TITLE_IDS.has(titleId);
}

/** The i18n key (namespace "hof", e.g. "titles.level.1") for a title id, or
 * `null` for an unknown/absent one — the pure, i18n-free half of this module. */
export function titleI18nKey(titleId: string | null | undefined): string | null {
  if (!titleId || !VALID_TITLE_IDS.has(titleId)) return null;
  return `titles.${titleId}`;
}

/** A minimal translator shape (structurally compatible with next-intl's
 * `useTranslations` return value AND with `GameClient.tsx`'s ref-captured
 * `tHofRef.current`) so this helper works identically in a React render and
 * inside the non-React rAF-loop seam that feeds `setHeroSocialBadges`/
 * `setTownChampions`. */
export type TitleTranslator = (key: string) => string;

/** The localized display string for a title id, or `null` when the id is
 * unknown/absent (callers render nothing rather than a raw id). */
export function titleLabel(
  titleId: string | null | undefined,
  t: TitleTranslator,
): string | null {
  const key = titleI18nKey(titleId);
  return key ? t(key) : null;
}
