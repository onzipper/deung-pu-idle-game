/**
 * M8 party — HOF seasonal social-badge (title/champion) map builder for the
 * `GameRenderer.setHeroSocialBadges()` render seam.
 *
 * PURE module (no DOM/React/Pixi/relay import), headlessly testable exactly
 * like `cohortWallet.ts`/`partyHandshake.ts`.
 *
 * Bug fixed (owner live report): the HOF title vanished for EVERYONE the
 * instant a cohort formed (solo was fine). Root cause was an ELIMINATION
 * heuristic in `GameClient.tsx` ("whichever party row's userId ISN'T a
 * resolved cohort peer must be me") — it silently mis-assigns the moment the
 * party has ANY member who isn't part of the CURRENT same-zone cohort (a
 * party can hold members elsewhere/offline; nothing requires party size ==
 * cohort size). A second "not a peer" row overwrote (or blanked) my own
 * badge in the map, last-write-wins.
 *
 * This module instead mirrors `currentHeroDisplayNames`'s exact keying:
 * peers are resolved via `cohortMemberIds` (ticket slot -> userId, NEVER
 * includes my own slot) -> `lastCohortSlots` (ticket slot -> cohort hero
 * index) -> that peer's party row by userId. MY OWN badge comes straight
 * from `mySocialBadge` (the same already-localized source the solo path
 * uses) keyed onto `heroes[myCohortIndex]` directly — no elimination, no
 * dependency on the party poll having landed, immune to extra non-cohort
 * party members.
 */

export interface SocialBadge {
  title: string | null;
  champion: boolean;
}

/** The shape of one party row this module needs — a structural subset of
 *  `ui/friends/types.ts`'s `PartyMemberWire`. */
export interface CohortPartyMemberRow {
  userId: string;
  /** RAW title id ("<board>.<rank>") as the server sends it — localized here
   *  via the injected `localizeTitle` (mirrors `ui/hof/titles.ts`'s
   *  `titleLabel`, kept as a plain function param so this module stays
   *  i18n-free/pure). */
  title: string | null;
  champion: boolean;
}

/** Minimal hero shape this module needs — avoids an engine import, same
 *  "pure module, structural types" convention as `cohortWallet.ts`. */
export interface BadgeHero {
  id: number;
}

/**
 * Build the `heroId -> {title, champion}` map for a LIVE cohort.
 *
 * `cohortMemberIds`/`lastCohortSlots` are the exact same two structures
 * `GameClient.tsx`'s `currentHeroDisplayNames()` keys off — this function
 * must keep using them identically so a hero's nameplate and its title tag
 * are always in agreement about which hero is which.
 */
export function buildCohortSocialBadges(
  heroes: readonly BadgeHero[],
  myCohortIndex: number,
  myBadge: SocialBadge | null,
  cohortMemberIds: ReadonlyMap<number, string>,
  lastCohortSlots: readonly number[],
  partyMembers: readonly CohortPartyMemberRow[],
  localizeTitle: (titleId: string | null) => string | null,
): Map<string, SocialBadge> {
  const badges = new Map<string, SocialBadge>();

  const myHero = heroes[myCohortIndex];
  if (myBadge && myHero) badges.set(String(myHero.id), myBadge);

  for (const [ticketSlot, userId] of cohortMemberIds) {
    const idx = lastCohortSlots.indexOf(ticketSlot);
    const hero = idx >= 0 ? heroes[idx] : undefined;
    if (!hero) continue;
    const member = partyMembers.find((m) => m.userId === userId);
    if (!member) continue;
    badges.set(String(hero.id), { title: localizeTitle(member.title), champion: member.champion });
  }

  return badges;
}
