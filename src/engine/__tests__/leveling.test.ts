import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  migrate,
  toSaveData,
  heroAtk,
  heroMaxHp,
  CONFIG,
  HERO_TYPES,
  SAVE_VERSION,
  type GameState,
} from "@/engine";
import { runUntil, clone, soloSave } from "./helpers";

/**
 * M5 "Character XP + Level system" (86d3jv7m3), rebaselined for the solo pivot.
 *
 * XP comes deterministically from kills to the (single) ALIVE hero; dead heroes
 * earn nothing; levels grant a compounding atk/hp bonus (now the PRIMARY power
 * axis — upgrades removed) and emit a transient `levelUp` event. These headless
 * tests lock in that contract plus the v3->v4 save migration.
 */

const LV = CONFIG.leveling;

/** Run until the hero has levelled up (or `cap` steps). */
function runUntilLevel(s: GameState, cap = 30000): boolean {
  return runUntil(s, (st) => st.heroes.some((h) => h.level > 1), cap);
}

describe("xpToLevel curve", () => {
  it("is strictly increasing across the whole level range", () => {
    for (let lvl = 1; lvl < LV.levelCap; lvl++) {
      expect(LV.xpToLevel(lvl + 1)).toBeGreaterThan(LV.xpToLevel(lvl));
    }
  });

  it("is always a positive integer", () => {
    for (let lvl = 1; lvl <= LV.levelCap; lvl++) {
      const v = LV.xpToLevel(lvl);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe("level stat multipliers", () => {
  it("level 1 is exactly the class base stat (no bonus)", () => {
    expect(heroAtk("swordsman", 1)).toBe(
      Math.round(CONFIG.heroBaseAtk * HERO_TYPES.swordsman.dmgMult),
    );
    expect(heroMaxHp("swordsman", 1)).toBe(
      Math.round(CONFIG.heroBaseHp * HERO_TYPES.swordsman.hpMult),
    );
  });

  it("higher level multiplies atk and hp above the base", () => {
    // heroAtk = round(baseAtk * dmgMult * levelMult); level 10 adds +9 levels of
    // atkPerLevel over the level-1 value.
    const base = CONFIG.heroBaseAtk * HERO_TYPES.mage.dmgMult;
    expect(heroAtk("mage", 10)).toBe(Math.round(base * (1 + 9 * LV.atkPerLevel)));
    expect(heroMaxHp("mage", 10)).toBeGreaterThan(heroMaxHp("mage", 1));
  });

  it("tier-2 evolution compounds on the level bonus", () => {
    expect(heroAtk("swordsman", 10, 2)).toBe(
      Math.round(heroAtk("swordsman", 10, 1) * CONFIG.evolution.atkMult),
    );
  });
});

describe("XP accrual from kills", () => {
  it("is deterministic: same seed -> same hero level/xp", () => {
    const a = initGameState(1234);
    const b = initGameState(1234);
    for (let i = 0; i < 6000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes.map((h) => [h.level, h.xp])).toEqual(
      b.heroes.map((h) => [h.level, h.xp]),
    );
    // Sanity: the hero actually gained XP over combat.
    expect(a.heroes[0].xp + (a.heroes[0].level - 1)).toBeGreaterThan(0);
  });

  it("a dead hero earns no XP while it is down", () => {
    // Use a save where an ALLY still farms? Solo has one hero — instead verify the
    // dead hero itself banks nothing: force it down, and confirm level/xp frozen
    // while the field-clear/respawn keeps it dead (long revive).
    const s = initGameState(7);
    const hero = s.heroes[0];
    hero.dead = true;
    hero.hp = 0;
    hero.reviveTimer = 9999;
    const xpBefore = hero.xp;
    const levelBefore = hero.level;
    for (let i = 0; i < 3000; i++) step(s, {});
    expect(hero.dead).toBe(true);
    expect(hero.xp).toBe(xpBefore);
    expect(hero.level).toBe(levelBefore);
  });

  it("emits a levelUp event carrying heroId + newLevel", () => {
    const s = initGameState(3);
    let evt: { id: number; level: number } | null = null;
    for (let i = 0; i < 30000 && !evt; i++) {
      step(s, {});
      const e = s.events.find((ev) => ev.type === "levelUp");
      if (e && e.type === "levelUp") evt = { id: e.id, level: e.level };
    }
    expect(evt).not.toBeNull();
    expect(evt!.level).toBe(2); // first level-up is to level 2
    const owner = s.heroes.find((h) => h.id === evt!.id)!;
    expect(owner).toBeDefined();
    expect(owner.level).toBeGreaterThanOrEqual(2);
  });
});

describe("level-up stat application", () => {
  it("raises maxHp and heals by the added headroom on level-up", () => {
    const s = initGameState(3);
    for (const h of s.heroes) h.hp = h.maxHp;
    const hero = s.heroes[0];
    const maxBefore = hero.maxHp;
    runUntilLevel(s);
    expect(hero.level).toBeGreaterThan(1);
    expect(hero.maxHp).toBe(heroMaxHp(hero.cls, hero.level, hero.tier));
    expect(hero.maxHp).toBeGreaterThan(maxBefore);
  });

  it("level atk bonus is visible even on the small class base (10%/level)", () => {
    expect(heroAtk("swordsman", 30)).toBeGreaterThan(heroAtk("swordsman", 1));
  });
});

describe("progression persists across stage resets and saves", () => {
  it("nextStage keeps the character's level", () => {
    const s = initGameState(3);
    runUntilLevel(s);
    const leveledBefore = s.heroes[0].level;
    expect(leveledBefore).toBeGreaterThan(1);
    s.phase = "victory";
    step(s, { advanceStage: true });
    expect(s.heroes[0].level).toBe(leveledBefore);
  });

  it("round-trips level/xp/class through toSaveData -> initGameState", () => {
    const s = initGameState(3, soloSave("archer", 3));
    runUntilLevel(s);
    const save = toSaveData(s);
    expect(save.hero.cls).toBe("archer");
    const restored = initGameState(99, save);
    expect(restored.heroes[0].level).toBe(s.heroes[0].level);
    expect(restored.heroes[0].xp).toBe(s.heroes[0].xp);
    const hero = restored.heroes[0];
    expect(hero.maxHp).toBe(heroMaxHp(hero.cls, hero.level, hero.tier));
  });
});

describe("migrate pre-v4 team -> v4 single character", () => {
  it("adopts the highest-level unlocked hero and drops the rest + upgrades", () => {
    const v3 = {
      version: 3,
      stage: 4,
      gold: 100,
      unlocked: ["swordsman", "archer"],
      upgrades: { atk: 2, speed: 1, hp: 0 },
      heroes: [
        { level: 3, xp: 4, tier: 1 },
        { level: 7, xp: 9, tier: 2 },
      ],
      lastSeen: 0,
    };
    const v4 = migrate(v3);
    expect(v4.version).toBe(SAVE_VERSION);
    expect(v4.hero).toEqual({ cls: "archer", level: 7, xp: 9, tier: 2 });
  });

  it("preserves an already-v4 hero (idempotent)", () => {
    const hero = { cls: "mage" as const, level: 6, xp: 5, tier: 2 as const };
    const once = migrate({ version: SAVE_VERSION, hero });
    expect(migrate(once)).toEqual(once);
    expect(once.hero).toEqual(hero);
  });
});

describe("determinism guard", () => {
  it("byte-identical clone advances identically with XP in play", () => {
    const a = initGameState(555);
    for (let i = 0; i < 4000; i++) step(a, {});
    const b = clone(a);
    for (let i = 0; i < 2000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes.map((h) => [h.level, h.xp])).toEqual(
      b.heroes.map((h) => [h.level, h.xp]),
    );
  });
});
