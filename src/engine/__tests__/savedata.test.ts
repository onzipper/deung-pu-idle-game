import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  heroMaxMana,
  initGameState,
  toSaveData,
  step,
} from "@/engine";
import { soloSave } from "./helpers";

/**
 * `toSaveData` is the inverse of `initGameState(seed, save)` — it serialises the
 * live state back down to the persisted subset. M5: the shape is a SINGLE
 * character (`hero: {cls, level, xp, tier}`) with the upgrade lines gone.
 */
describe("toSaveData (v4 single character)", () => {
  it("emits the current SAVE_VERSION and a server-owned lastSeen of 0", () => {
    const s = initGameState(1);
    const save = toSaveData(s);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.lastSeen).toBe(0);
  });

  it("defaults a cold start to a fresh swordsman (level 1, 0 stat points, base stats)", () => {
    const cold = toSaveData(initGameState(1));
    expect(cold.hero).toEqual({
      cls: "swordsman",
      level: 1,
      xp: 0,
      tier: 1,
      statPoints: 0,
      stats: { ...CONFIG.stats.base.swordsman },
      mana: heroMaxMana("swordsman", CONFIG.stats.base.swordsman.int),
      autoSlots: ["sword_whirl", null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    });
  });

  it("round-trips the chosen class + progress + economy through initGameState", () => {
    const original = soloSave("mage", 5);
    original.gold = 1234;
    original.hero = {
      cls: "mage",
      level: 12,
      xp: 30,
      tier: 2,
      statPoints: 6,
      stats: { str: 3, dex: 4, int: 30, vit: 10 },
      // Mana (≤ the int-30 pool) + a fuller auto-slot loadout must round-trip.
      mana: 100,
      autoSlots: ["mage_meteor", "mage_frostnova", null],
      // Tier 2 -> no active quest (consumed by the class change); must round-trip.
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    };

    const restored = toSaveData(initGameState(9, original));
    expect(restored.stage).toBe(original.stage);
    expect(restored.gold).toBe(original.gold);
    expect(restored.hero).toEqual(original.hero);
  });

  it("captures gold/stage advanced by the live sim", () => {
    const s = initGameState(7, soloSave("archer", 3));
    s.gold = 42;
    step(s, {});
    expect(toSaveData(s).gold).toBe(42);
  });

  it("spawns exactly one hero of the chosen class", () => {
    const s = initGameState(1, soloSave("archer", 1));
    expect(s.heroes).toHaveLength(1);
    expect(s.heroes[0].cls).toBe("archer");
    expect(s.heroClass).toBe("archer");
  });
});
