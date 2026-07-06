import { describe, expect, it } from "vitest";
import { CONFIG, initGameState, repairHeroClass, toSaveData } from "@/engine";
import { soloSave } from "./helpers";

/**
 * 2026-07-06 "everyone is a swordsman" bug: a fresh character had no save row,
 * the client booted the swordsman default, and the first autosave locked the
 * wrong class in. `repairHeroClass` heals a corrupted save from the account's
 * authoritative Character.baseClass; `initGameState`'s `fallbackClass` seeds a
 * first boot correctly so the bug can't re-mint.
 */
describe("repairHeroClass", () => {
  it("is identity when the save already matches", () => {
    const save = soloSave("archer", 3);
    expect(repairHeroClass(save, "archer")).toBe(save);
  });

  it("corrects the class, resets stats to the true base, refunds all points", () => {
    const save = soloSave("swordsman", 5);
    save.hero.level = 20;
    // Simulate 19 level-ups auto-dumped into the WRONG primary (str).
    save.hero.stats = { str: 8 + 57, dex: 4, int: 3, vit: 6 };
    save.hero.statPoints = 0;

    const fixed = repairHeroClass(save, "archer");
    expect(fixed.hero.cls).toBe("archer");
    expect(fixed.hero.stats).toEqual(CONFIG.stats.base.archer);
    expect(fixed.hero.statPoints).toBe(19 * CONFIG.stats.pointsPerLevel);
    // Progress survives untouched.
    expect(fixed.hero.level).toBe(20);
    expect(fixed.gold).toBe(save.gold);
    expect(fixed.stage).toBe(save.stage);
  });

  it("round-trips through initGameState with wrong-class slots normalised", () => {
    const save = soloSave("swordsman", 4);
    save.hero.level = 12;
    save.hero.autoSlots = ["sword_whirl", null, null]; // swordsman skill
    const fixed = repairHeroClass(save, "mage");
    const s = initGameState(7, fixed);
    expect(s.heroClass).toBe("mage");
    expect(s.heroes[0].cls).toBe("mage");
    // The wrong-class slotted skill was dropped/replaced by the mage defaults.
    expect(s.heroes[0].autoSlots.includes("sword_whirl")).toBe(false);
    // And it persists back out as a mage save.
    expect(toSaveData(s).hero.cls).toBe("mage");
  });

  it("initGameState fallbackClass seeds a FRESH boot with the true class", () => {
    const s = initGameState(1, undefined, "mage");
    expect(s.heroClass).toBe("mage");
    expect(s.heroes[0].cls).toBe("mage");
    // Without the fallback the old default applies (compat).
    expect(initGameState(1).heroClass).toBe("swordsman");
  });
});
