import { describe, expect, it } from "vitest";
import { CONFIG } from "@/engine";
import { buildActiveBuffBadges, capBuffBadges, type BuffBadge } from "@/ui/buffs/activeBuffs";

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

  it("every badge carries a sourceKey (v2: source-labeled chips, owner ask) — today equal to its kind", () => {
    const badges = buildActiveBuffBadges({ heroesLength: 2, atkBuffMult: 1.2, atkBuffTimer: 3 });
    expect(badges.map((b) => ({ kind: b.kind, sourceKey: b.sourceKey }))).toEqual([
      { kind: "partyExp", sourceKey: "partyExp" },
      { kind: "warCry", sourceKey: "warCry" },
    ]);
  });
});

function makeBadge(id: string): BuffBadge {
  return { id, kind: "warCry", icon: "x", sourceKey: "warCry", params: {} };
}

describe("capBuffBadges", () => {
  it("shows every badge as a real chip (no overflow) when the count already fits", () => {
    const badges = [makeBadge("a"), makeBadge("b")];
    expect(capBuffBadges(badges, 2)).toEqual({ visible: badges, overflow: [] });
    expect(capBuffBadges(badges, 3)).toEqual({ visible: badges, overflow: [] });
  });

  it("reserves one slot for the overflow chip once the count exceeds maxVisible", () => {
    const badges = [makeBadge("a"), makeBadge("b"), makeBadge("c")];
    const { visible, overflow } = capBuffBadges(badges, 2);
    expect(visible.map((b) => b.id)).toEqual(["a"]);
    expect(overflow.map((b) => b.id)).toEqual(["b", "c"]);
  });

  it("total rendered slots (visible + 1 overflow chip) never exceeds maxVisible", () => {
    const badges = [makeBadge("a"), makeBadge("b"), makeBadge("c"), makeBadge("d")];
    const { visible, overflow } = capBuffBadges(badges, 3);
    expect(visible).toHaveLength(2);
    expect(overflow).toHaveLength(2);
    expect(visible.length + (overflow.length > 0 ? 1 : 0)).toBeLessThanOrEqual(3);
  });

  it("handles an empty list and a zero cap without throwing", () => {
    expect(capBuffBadges([], 2)).toEqual({ visible: [], overflow: [] });
    expect(capBuffBadges([makeBadge("a")], 0)).toEqual({ visible: [], overflow: [makeBadge("a")] });
  });
});
