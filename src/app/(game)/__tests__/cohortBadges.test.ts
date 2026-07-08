import { describe, expect, it } from "vitest";
import { buildCohortSocialBadges, type CohortPartyMemberRow } from "../cohortBadges";

const identity = (id: string | null): string | null => (id ? `LOC(${id})` : null);

describe("buildCohortSocialBadges", () => {
  it("keys MY badge onto heroes[myCohortIndex] via mySocialBadge, independent of party rows", () => {
    const heroes = [{ id: 7 }, { id: 8 }];
    const badges = buildCohortSocialBadges(
      heroes,
      /* myCohortIndex */ 1,
      { title: "จ้าวยุทธภพ", champion: true },
      new Map([[0, "peer-uid"]]),
      /* lastCohortSlots */ [0, 3],
      [
        { userId: "peer-uid", title: "level.1", champion: false },
        { userId: "me-uid", title: "power.2", champion: false },
      ],
      identity,
    );
    // Note: MY row's title is NEVER read off `partyMembers` — `mySocialBadge`
    // (already localized/authoritative) wins directly.
    expect(badges.get("8")).toEqual({ title: "จ้าวยุทธภพ", champion: true });
  });

  it("resolves a peer's title through the injected localizer, keyed via cohortMemberIds -> lastCohortSlots (mirrors currentHeroDisplayNames)", () => {
    const heroes = [{ id: 100 }, { id: 200 }];
    const badges = buildCohortSocialBadges(
      heroes,
      0,
      null,
      new Map([[5, "peer-uid"]]),
      [1, 5], // ticket slot 5 -> cohort index 1 -> heroes[1] (id 200)
      [{ userId: "peer-uid", title: "gold.3", champion: true }],
      identity,
    );
    expect(badges.get("200")).toEqual({ title: "LOC(gold.3)", champion: true });
    expect(badges.has("100")).toBe(false); // no mySocialBadge supplied
  });

  it("REGRESSION (owner live bug): an extra party member NOT in the current cohort never overwrites/blanks my badge", () => {
    // Party of 3, but only 2 (me + peer) share a zone right now — the 3rd
    // member is elsewhere. The old elimination heuristic ("whichever row's
    // userId isn't a resolved peer must be me") treated BOTH me and the
    // absent 3rd member as "me", last-write-wins blanking my title.
    const heroes = [{ id: 1 }, { id: 2 }];
    const badges = buildCohortSocialBadges(
      heroes,
      0,
      { title: "MY TITLE", champion: false },
      new Map([[1, "peer-uid"]]), // only the in-zone peer is a cohort member
      [0, 1],
      [
        { userId: "me-uid", title: "level.1", champion: false },
        { userId: "peer-uid", title: null, champion: false },
        { userId: "elsewhere-uid", title: null, champion: false }, // 3rd party member, not in cohort
      ],
      identity,
    );
    expect(badges.get("1")).toEqual({ title: "MY TITLE", champion: false });
    expect(badges.get("2")).toEqual({ title: null, champion: false });
    expect(badges.size).toBe(2);
  });

  it("omits a peer whose party row hasn't resolved yet (no member match) without touching my own badge", () => {
    const heroes = [{ id: 1 }, { id: 2 }];
    const badges = buildCohortSocialBadges(
      heroes,
      0,
      { title: "MY TITLE", champion: true },
      new Map([[1, "peer-uid"]]),
      [0, 1],
      [] as CohortPartyMemberRow[], // party poll hasn't landed yet
      identity,
    );
    expect(badges.get("1")).toEqual({ title: "MY TITLE", champion: true });
    expect(badges.has("2")).toBe(false);
    expect(badges.size).toBe(1);
  });

  it("omits my own badge when mySocialBadge is null (no fabricated entry)", () => {
    const heroes = [{ id: 42 }];
    const badges = buildCohortSocialBadges(heroes, 0, null, new Map(), [0], [], identity);
    expect(badges.size).toBe(0);
  });
});
