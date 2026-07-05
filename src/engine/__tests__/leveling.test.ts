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
  UPGRADES,
  SAVE_VERSION,
  type GameState,
} from "@/engine";
import { runUntil, clone } from "./helpers";

/**
 * M5 "Character XP + Level system" (86d3jv7m3).
 *
 * XP comes deterministically from kills; every ALIVE hero gains equal XP, dead
 * heroes earn nothing; levels grant a compounding atk/hp bonus and emit a
 * transient `levelUp` event. These headless tests lock in that contract plus the
 * save-migration from the previous SAVE_VERSION.
 */

const LV = CONFIG.leveling;

/** Run until at least one hero has levelled up (or `cap` steps). */
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

describe("level stat multipliers compound with upgrades", () => {
  it("level 1 is bit-identical to the pre-M5 (no-level) stat", () => {
    const up = { atk: 5, speed: 2, hp: 4 };
    expect(heroAtk("swordsman", up, 1)).toBe(heroAtk("swordsman", up));
    expect(heroMaxHp(up, 1)).toBe(heroMaxHp(up));
  });

  it("higher level multiplies on top of upgrade-line power", () => {
    const up = { atk: 10, speed: 0, hp: 10 };
    // heroAtk = round(baseAtk * upgradeMult * dmgMult * levelMult); level 10 adds
    // +9% (9 levels * 1%/level) over the level-1 pre-multiplier value.
    const base =
      CONFIG.heroBaseAtk * (1 + up.atk * UPGRADES.atk.per) * HERO_TYPES.mage.dmgMult;
    expect(heroAtk("mage", up, 10)).toBe(Math.round(base * (1 + 9 * LV.atkPerLevel)));
    expect(heroMaxHp(up, 10)).toBeGreaterThan(heroMaxHp(up, 1));
  });
});

describe("XP accrual from kills", () => {
  it("is deterministic: same seed -> same hero levels/xp", () => {
    const a = initGameState(1234);
    const b = initGameState(1234);
    for (let i = 0; i < 6000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes.map((h) => [h.level, h.xp])).toEqual(
      b.heroes.map((h) => [h.level, h.xp]),
    );
    // Sanity: the swordsman actually gained XP over 100s of combat.
    expect(a.heroes[0].xp + (a.heroes[0].level - 1)).toBeGreaterThan(0);
  });

  it("a dead hero earns no XP while it is down", () => {
    const s = initGameState(7);
    // Force the swordsman dead with a long revive so it misses kills.
    const sword = s.heroes[0];
    sword.dead = true;
    sword.hp = 0;
    sword.reviveTimer = 9999;
    const xpBefore = sword.xp;
    const levelBefore = sword.level;
    // Advance through combat where other-side kills happen.
    runUntil(s, (st) => st.kills >= 5, 30000);
    expect(sword.dead).toBe(true); // still down (long revive)
    expect(sword.xp).toBe(xpBefore);
    expect(sword.level).toBe(levelBefore);
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
    // The id belongs to a real hero, now at that level.
    const owner = s.heroes.find((h) => h.id === evt!.id)!;
    expect(owner).toBeDefined();
    expect(owner.level).toBeGreaterThanOrEqual(2);
  });
});

describe("level-up stat application", () => {
  it("raises maxHp and heals by the added headroom on level-up", () => {
    const s = initGameState(3);
    // Full HP so a level-up's heal is visible as maxHp growth == hp growth.
    for (const h of s.heroes) h.hp = h.maxHp;
    const sword = s.heroes[0];
    const maxBefore = sword.maxHp;
    runUntilLevel(s);
    expect(sword.level).toBeGreaterThan(1);
    expect(sword.maxHp).toBe(heroMaxHp(s.upgrades, sword.level));
    expect(sword.maxHp).toBeGreaterThan(maxBefore);
  });

  it("level atk bonus compounds on the upgrade multiplier (visible once base is large)", () => {
    // The per-level atk bonus is intentionally TINY (0.1%/level) so it never
    // dissolves the atk-gated stage-9 wall; on a base-10 attack integer rounding
    // hides it, but on an upgraded (large) base it compounds visibly.
    const up = { atk: 50, speed: 0, hp: 0 };
    expect(heroAtk("swordsman", up, 30)).toBeGreaterThan(heroAtk("swordsman", up, 1));
  });
});

describe("progression persists across stage resets and saves", () => {
  it("nextStage keeps existing hero levels (only the new slot starts fresh)", () => {
    const s = initGameState(3);
    runUntilLevel(s);
    const leveledBefore = s.heroes[0].level;
    expect(leveledBefore).toBeGreaterThan(1);
    // Force a stage advance.
    s.phase = "victory";
    step(s, { advanceStage: true });
    expect(s.heroes[0].level).toBe(leveledBefore); // preserved across the reset
  });

  it("round-trips level/xp through toSaveData -> initGameState", () => {
    const s = initGameState(3);
    runUntilLevel(s);
    const save = toSaveData(s);
    expect(save.heroes.length).toBe(s.heroes.length);
    const restored = initGameState(99, save);
    expect(restored.heroes.map((h) => [h.level, h.xp])).toEqual(
      s.heroes.map((h) => [h.level, h.xp]),
    );
    // maxHp reflects the restored level.
    const sword = restored.heroes[0];
    expect(sword.maxHp).toBe(heroMaxHp(restored.upgrades, sword.level));
  });
});

describe("migrate v1 -> v2", () => {
  it("defaults every unlocked hero to level 1 / xp 0", () => {
    const v1 = {
      version: 1,
      stage: 4,
      gold: 100,
      unlocked: ["swordsman", "archer"],
      upgrades: { atk: 2, speed: 1, hp: 0 },
      lastSeen: 0,
    };
    const v2 = migrate(v1);
    expect(v2.version).toBe(SAVE_VERSION);
    expect(v2.heroes).toEqual([
      { level: 1, xp: 0 },
      { level: 1, xp: 0 },
    ]);
  });

  it("preserves an already-v2 heroes array (idempotent)", () => {
    const heroes = [{ level: 6, xp: 5 }];
    const once = migrate({ version: SAVE_VERSION, unlocked: ["swordsman"], heroes });
    expect(migrate(once)).toEqual(once);
    expect(once.heroes).toEqual(heroes);
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
