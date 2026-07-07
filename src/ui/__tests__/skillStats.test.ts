import { describe, expect, it } from "vitest";
import { SKILLS } from "@/engine";
import { skillStatParts } from "@/ui/skillStats";

describe("skillStatParts", () => {
  it("sword_whirl (nova, AoE, no targets): damage, radius, mana, cooldown", () => {
    const parts = skillStatParts(SKILLS.sword_whirl);
    expect(parts).toEqual([
      { key: "damage", values: { mult: "3.2" } },
      { key: "radius", values: { radius: 115 } },
      { key: "mana", values: { cost: 18 } },
      { key: "cooldown", values: { cd: 5 } },
    ]);
  });

  it("mage_meteor: an integer mult formats without a trailing .0", () => {
    const parts = skillStatParts(SKILLS.mage_meteor);
    expect(parts[0]).toEqual({ key: "damage", values: { mult: "7" } });
  });

  it("archer_rain (rain, targets>0): includes a targets part", () => {
    const parts = skillStatParts(SKILLS.archer_rain);
    expect(parts.some((p) => p.key === "targets")).toBe(true);
    const targetsPart = parts.find((p) => p.key === "targets");
    expect(targetsPart?.values).toEqual({ targets: 9 });
  });

  it("archer_powershot (bolt, no radius, no targets): damage, mana, cooldown only", () => {
    const parts = skillStatParts(SKILLS.archer_powershot);
    expect(parts.map((p) => p.key)).toEqual(["damage", "mana", "cooldown"]);
  });

  it("sword_warcry (buff kind): buff percent/duration instead of damage", () => {
    const parts = skillStatParts(SKILLS.sword_warcry);
    expect(parts[0]).toEqual({ key: "buff", values: { percent: 50, seconds: 6 } });
    expect(parts.some((p) => p.key === "damage")).toBe(false);
  });

  it("every skill always ends with mana then cooldown", () => {
    for (const skill of Object.values(SKILLS)) {
      const parts = skillStatParts(skill);
      expect(parts.at(-2)?.key).toBe("mana");
      expect(parts.at(-1)?.key).toBe("cooldown");
    }
  });
});
