import { describe, expect, it } from "vitest";
import { CONFIG } from "@/engine";
import { buildActiveBuffBadges } from "@/ui/buffs/activeBuffs";

const solo = { heroesLength: 1, atkBuffMult: 1, atkBuffTimer: 0 };

describe("buildActiveBuffBadges", () => {
  it("is empty solo with no buffs active", () => {
    expect(buildActiveBuffBadges(solo)).toEqual([]);
  });

  it("adds the party XP badge whenever cohort size > 1, using the engine's own expBuff curve", () => {
    const badges = buildActiveBuffBadges({ ...solo, heroesLength: 3 });
    expect(badges).toHaveLength(1);
    const expected = Math.round((CONFIG.party.expBuff(3) - 1) * 100);
    expect(badges[0]).toMatchObject({ id: "partyExp", kind: "partyExp", params: { percent: expected, count: 3 } });
  });

  it("never shows the party badge solo (heroesLength 1)", () => {
    expect(buildActiveBuffBadges({ ...solo, heroesLength: 1 })).toEqual([]);
  });

  it("adds the war-cry badge whenever atkBuffTimer > 0, carrying percent + ceil(seconds)", () => {
    const badges = buildActiveBuffBadges({ ...solo, atkBuffMult: 1.3, atkBuffTimer: 4.2 });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ id: "warCry", kind: "warCry", params: { percent: 30, seconds: 5 } });
  });

  it("hides the war-cry badge once the timer hits zero", () => {
    expect(buildActiveBuffBadges({ ...solo, atkBuffMult: 1.3, atkBuffTimer: 0 })).toEqual([]);
  });

  it("shows both badges together, party first (registration order)", () => {
    const badges = buildActiveBuffBadges({ heroesLength: 2, atkBuffMult: 1.2, atkBuffTimer: 3 });
    expect(badges.map((b) => b.id)).toEqual(["partyExp", "warCry"]);
  });

  it("floors a party buff of exactly 0% (defensive — expBuff should never actually do this)", () => {
    // A hypothetical zero-effect multiplier at size>1 should never render an
    // empty "+0% EXP" badge.
    expect(buildActiveBuffBadges({ heroesLength: 1, atkBuffMult: 1, atkBuffTimer: 0 })).toEqual([]);
  });
});
