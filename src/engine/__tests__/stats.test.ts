import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  migrate,
  toSaveData,
  combatPower,
  heroAtk,
  heroMaxHp,
  heroAtkSpeed,
  primaryStat,
  baseStats,
  CONFIG,
  HERO_TYPES,
  SAVE_VERSION,
  type GameState,
  type HeroClass,
} from "@/engine";
import { clone, soloSave } from "./helpers";

/**
 * M5 "Base stats" (86d3jv7m3): 4 RO-flavoured axes (str/dex/int/vit) allocated on
 * level-up. A class's DAMAGE scales off its PRIMARY stat; dex adds a small
 * universal atk-speed factor and vit adds max HP. These headless tests lock in the
 * allocation intent (once-per-click, cap/negative rejection), the auto-allocate
 * determinism + baseline-tracking re-tune, combatPower monotonicity, and the
 * v4->v5 retroactive-points migration.
 */

const ST = CONFIG.stats;
const CLASSES: HeroClass[] = ["swordsman", "archer", "mage"];

/** Sum of the two atk knobs the re-tune moved apart — must equal the pre-stats
 * 0.10/level total so an auto-allocated hero tracks the old baseline exactly. */
const TOTAL_ATK_PER_LEVEL = CONFIG.leveling.atkPerLevel + ST.pointsPerLevel * ST.atkPerPrimaryPoint;

describe("base stat config sanity", () => {
  it("the atk re-tune sums back to the pre-stats 0.10/level total", () => {
    expect(TOTAL_ATK_PER_LEVEL).toBeCloseTo(0.1, 10);
  });

  it("a fresh hero starts on the class base stats with 0 unspent points", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 1));
      const h = s.heroes[0];
      expect(h.stats).toEqual(baseStats(cls));
      expect(h.statPoints).toBe(0);
    }
  });

  it("primaryStat maps each class to its damage stat", () => {
    expect(primaryStat("swordsman")).toBe("str");
    expect(primaryStat("archer")).toBe("dex");
    expect(primaryStat("mage")).toBe("int");
  });
});

describe("stat effects (per point)", () => {
  it("a primary-stat point above base raises atk by atkPerPrimaryPoint (× base)", () => {
    for (const cls of CLASSES) {
      const p = primaryStat(cls);
      const base = ST.base[cls][p];
      const scale = CONFIG.heroBaseAtk * HERO_TYPES[cls].dmgMult;
      expect(heroAtk(cls, 1, 1, base)).toBe(Math.round(scale)); // no bonus at base
      expect(heroAtk(cls, 1, 1, base + 10)).toBe(
        Math.round(scale * (1 + 10 * ST.atkPerPrimaryPoint)),
      );
    }
  });

  it("a vit point above base raises max HP by hpPerVitPoint (× base)", () => {
    for (const cls of CLASSES) {
      const base = ST.base[cls].vit;
      const scale = CONFIG.heroBaseHp * HERO_TYPES[cls].hpMult;
      expect(heroMaxHp(cls, 1, 1, base)).toBe(Math.round(scale));
      expect(heroMaxHp(cls, 1, 1, base + 10)).toBe(
        Math.round(scale * (1 + 10 * ST.hpPerVitPoint)),
      );
    }
  });

  it("a dex point above base speeds up attacks (lower cooldown), universally", () => {
    for (const cls of CLASSES) {
      const base = ST.base[cls].dex;
      expect(heroAtkSpeed(cls, base)).toBe(HERO_TYPES[cls].atkSpeed);
      expect(heroAtkSpeed(cls, base + 50)).toBeLessThan(HERO_TYPES[cls].atkSpeed);
    }
  });

  it("an off-affinity damage stat is inert (str on an archer does nothing)", () => {
    // The archer's damage scales off dex; feeding a str value never enters heroAtk.
    const atBase = heroAtk("archer", 5);
    expect(heroAtk("archer", 5, 1, ST.base.archer.dex)).toBe(atBase);
  });
});

describe("auto-allocate reproduces the pre-stats baseline atk", () => {
  it("a fully-primary-allocated hero equals the old 0.10/level formula", () => {
    for (const cls of CLASSES) {
      const p = primaryStat(cls);
      for (const L of [1, 10, 25, 40, CONFIG.leveling.levelCap]) {
        const allocated = ST.base[cls][p] + (L - 1) * ST.pointsPerLevel;
        const expected = Math.round(
          CONFIG.heroBaseAtk * HERO_TYPES[cls].dmgMult * (1 + (L - 1) * TOTAL_ATK_PER_LEVEL),
        );
        expect(heroAtk(cls, L, 1, allocated)).toBe(expected);
      }
    }
  });
});

describe("allocateStat intent", () => {
  /** Give the solo hero some unspent points to spend. */
  function withPoints(seed = 1, points = 9): GameState {
    const s = initGameState(seed);
    s.heroes[0].statPoints = points;
    return s;
  }

  it("spends points into the chosen stat exactly once per drained input", () => {
    const s = withPoints();
    const before = s.heroes[0].stats.str;
    step(s, { allocateStat: { stat: "str", amount: 3 } });
    expect(s.heroes[0].stats.str).toBe(before + 3);
    expect(s.heroes[0].statPoints).toBe(6);
  });

  it("allocating vit raises maxHp and heals by the headroom", () => {
    const s = withPoints();
    const h = s.heroes[0];
    h.hp = h.maxHp;
    const maxBefore = h.maxHp;
    step(s, { allocateStat: { stat: "vit", amount: 5 } });
    expect(h.maxHp).toBeGreaterThan(maxBefore);
    expect(h.hp).toBe(maxBefore + (h.maxHp - maxBefore));
  });

  it("rejects an over-spend (more than unspent points) — no-op", () => {
    const s = withPoints(1, 2);
    const before = { ...s.heroes[0].stats };
    step(s, { allocateStat: { stat: "dex", amount: 5 } });
    expect(s.heroes[0].stats).toEqual(before);
    expect(s.heroes[0].statPoints).toBe(2);
  });

  it("rejects negative / zero / non-integer amounts — no-op", () => {
    for (const amount of [-3, 0, 1.5]) {
      const s = withPoints();
      const before = { ...s.heroes[0].stats };
      step(s, { allocateStat: { stat: "str", amount } });
      expect(s.heroes[0].stats).toEqual(before);
      expect(s.heroes[0].statPoints).toBe(9);
    }
  });

  it("rejects an allocation that would breach the per-stat cap — no-op", () => {
    const s = withPoints(1, 5);
    s.heroes[0].stats.str = CONFIG.stats.cap - 2;
    step(s, { allocateStat: { stat: "str", amount: 5 } });
    expect(s.heroes[0].stats.str).toBe(CONFIG.stats.cap - 2);
    expect(s.heroes[0].statPoints).toBe(5);
  });

  it("emits a statAllocated event ONLY on a manual (accepted) allocation", () => {
    const s = withPoints();
    step(s, { allocateStat: { stat: "int", amount: 2 } });
    const evts = s.events.filter((e) => e.type === "statAllocated");
    expect(evts.length).toBe(1);
    const e = evts[0];
    if (e.type !== "statAllocated") throw new Error("unreachable");
    expect(e).toMatchObject({ id: s.heroes[0].id, stat: "int", amount: 2 });
  });

  it("emits nothing on a rejected allocation", () => {
    const s = withPoints(1, 1);
    step(s, { allocateStat: { stat: "int", amount: 99 } });
    expect(s.events.some((e) => e.type === "statAllocated")).toBe(false);
  });
});

describe("auto-allocate v2 (ratio distribution)", () => {
  const STATS: ReadonlyArray<keyof typeof ST.base.swordsman> = ["str", "dex", "int", "vit"];
  const ratioOf = (cls: HeroClass) => ST.autoAllocRatio[cls] as Partial<Record<string, number>>;
  const ratioStats = (cls: HeroClass) => STATS.filter((s) => (ratioOf(cls)[s] ?? 0) > 0);

  it("drains every point toward the class ratio, silently (no event)", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 1));
      s.autoAllocate = true;
      s.heroes[0].statPoints = 120;
      step(s, {});
      expect(s.heroes[0].statPoints).toBe(0);
      // Off-ratio stats are untouched; on-ratio stats grew.
      for (const st of STATS) {
        const grew = s.heroes[0].stats[st] > ST.base[cls][st];
        expect(grew).toBe((ratioOf(cls)[st] ?? 0) > 0);
      }
      expect(s.events.some((e) => e.type === "statAllocated")).toBe(false);
    }
  });

  it("converges to the ratio: stats[s]/weight[s] equalises across ratio stats", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 1));
      s.autoAllocate = true;
      s.heroes[0].statPoints = 300;
      step(s, {});
      const rs = ratioStats(cls);
      const scores = rs.map((st) => s.heroes[0].stats[st] / (ratioOf(cls)[st] as number));
      // Each point goes to the current minimum score, so after draining the spread
      // between the highest and lowest score is at most one point-step (≤ 1).
      expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("keeps the primary/damage stat the majority of allocated points", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 1));
      s.autoAllocate = true;
      s.heroes[0].statPoints = 300;
      const p = primaryStat(cls);
      const beforeP = s.heroes[0].stats[p];
      step(s, {});
      const allocPrimary = s.heroes[0].stats[p] - beforeP;
      expect(allocPrimary).toBeGreaterThanOrEqual(150); // > half of 300
    }
  });

  it("self-corrects around manual allocation (funnels toward the lagging stat)", () => {
    // A swordsman with manually over-invested vit: auto then pours into str until
    // str/4 catches vit/1 (the ratio target), proving it tracks CURRENT stats.
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAllocate = true;
    s.heroes[0].stats.vit = 80; // far ahead of its 4:1 target
    s.heroes[0].statPoints = 40;
    const strBefore = s.heroes[0].stats.str;
    const vitBefore = s.heroes[0].stats.vit;
    step(s, {});
    expect(s.heroes[0].stats.str - strBefore).toBeGreaterThan(s.heroes[0].stats.vit - vitBefore);
  });

  it("a capped ratio stat drops out; the rest still absorb the points", () => {
    // Swordsman {str:4,vit:1}: vit pinned at cap → all points flow into str.
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAllocate = true;
    s.heroes[0].stats.vit = CONFIG.stats.cap;
    s.heroes[0].statPoints = 20;
    step(s, {});
    expect(s.heroes[0].stats.vit).toBe(CONFIG.stats.cap);
    expect(s.heroes[0].statPoints).toBe(0);
    expect(s.heroes[0].stats.str).toBeGreaterThan(ST.base.swordsman.str);
  });

  it("spills to the cap then leaves the remainder unspent when room runs out", () => {
    // Sword ratio {str:4,vit:1,int:1}: vit near cap (room 3), str + int capped →
    // 3 points fill vit, the rest stay unspent.
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAllocate = true;
    s.heroes[0].stats.str = CONFIG.stats.cap;
    s.heroes[0].stats.int = CONFIG.stats.cap;
    s.heroes[0].stats.vit = CONFIG.stats.cap - 3;
    s.heroes[0].statPoints = 10;
    step(s, {});
    expect(s.heroes[0].stats.vit).toBe(CONFIG.stats.cap);
    expect(s.heroes[0].statPoints).toBe(7);
  });

  it("leaves points unspent when every ratio stat is capped", () => {
    // Sword ratio {str:4,vit:1,int:1}: cap all three so no ratio stat has room.
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAllocate = true;
    s.heroes[0].stats.str = CONFIG.stats.cap;
    s.heroes[0].stats.int = CONFIG.stats.cap;
    s.heroes[0].stats.vit = CONFIG.stats.cap;
    s.heroes[0].statPoints = 5;
    step(s, {});
    expect(s.heroes[0].statPoints).toBe(5);
    expect(s.heroes[0].stats.str).toBe(CONFIG.stats.cap);
    expect(s.heroes[0].stats.vit).toBe(CONFIG.stats.cap);
  });

  it("is deterministic: a byte-identical clone with auto-allocate advances identically", () => {
    const a = initGameState(909);
    a.autoAllocate = true;
    for (let i = 0; i < 5000; i++) step(a, {});
    const b = clone(a);
    for (let i = 0; i < 3000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes.map((h) => [h.level, h.statPoints, h.stats])).toEqual(
      b.heroes.map((h) => [h.level, h.statPoints, h.stats]),
    );
    expect(a.rngState).toBe(b.rngState);
  });

  it("level-ups keep feeding auto-allocate (no unspent backlog builds up)", () => {
    const s = initGameState(3);
    s.autoAllocate = true;
    for (let i = 0; i < 30000 && s.heroes[0].level < 3; i++) step(s, {});
    expect(s.heroes[0].level).toBeGreaterThanOrEqual(3);
    // Auto runs at the top of every step (before that step's kills level the
    // hero), so at most ONE level's grant is ever briefly unspent — never an
    // unbounded backlog. A quiet step (no level-up) then drains it to 0.
    expect(s.heroes[0].statPoints).toBeLessThanOrEqual(ST.pointsPerLevel);
    const beforeLvl = s.heroes[0].level;
    for (let i = 0; i < 200 && s.heroes[0].level === beforeLvl; i++) step(s, {});
    // (Either it stayed on the same level for a spell and drained, or it levelled
    // again — either way the backlog stays bounded by one level's grant.)
    expect(s.heroes[0].statPoints).toBeLessThanOrEqual(ST.pointsPerLevel);
    expect(s.heroes[0].stats[primaryStat(s.heroes[0].cls)]).toBeGreaterThan(
      ST.base[s.heroes[0].cls][primaryStat(s.heroes[0].cls)],
    );
  });
});

describe("combatPower", () => {
  it("is non-decreasing in the primary stat, vit, level, and tier", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 1));
      const h = s.heroes[0];
      const base = combatPower(h);

      const p = primaryStat(cls);
      h.stats[p] += 20;
      const afterPrimary = combatPower(h);
      expect(afterPrimary).toBeGreaterThan(base);

      h.stats.vit += 20;
      const afterVit = combatPower(h);
      expect(afterVit).toBeGreaterThan(afterPrimary);

      h.level += 5;
      const afterLevel = combatPower(h);
      expect(afterLevel).toBeGreaterThan(afterVit);

      h.tier = 2;
      expect(combatPower(h)).toBeGreaterThan(afterLevel);
    }
  });

  it("counts skill DPS so a ranged class no longer under-reads vs raw atk", () => {
    // A mage's raw atk is modest, but its meteor is a big slice of DPS — combatPower
    // must exceed a naive atk-only read for it.
    const s = initGameState(1, soloSave("mage", 1));
    const h = s.heroes[0];
    expect(combatPower(h)).toBeGreaterThan(heroAtk(h.cls, h.level, h.tier));
  });

  it("allocating a dex point raises combatPower for a NON-primary-dex class too", () => {
    // Swordsman's damage is str-based, but dex still speeds attacks -> more DPS.
    const s = initGameState(1);
    const h = s.heroes[0]; // swordsman
    const before = combatPower(h);
    h.stats.dex += 30;
    expect(combatPower(h)).toBeGreaterThan(before);
  });
});

describe("base stats persist + migrate v4 -> v5", () => {
  it("round-trips statPoints + stats through toSaveData -> initGameState", () => {
    const s = initGameState(3, soloSave("mage", 4));
    s.heroes[0].statPoints = 7;
    step(s, { allocateStat: { stat: "int", amount: 4 } }); // int 8 -> 12, points 7 -> 3
    const save = toSaveData(s);
    expect(save.hero.statPoints).toBe(3);
    expect(save.hero.stats.int).toBe(ST.base.mage.int + 4);

    const restored = initGameState(99, save);
    expect(restored.heroes[0].statPoints).toBe(3);
    expect(restored.heroes[0].stats).toEqual(save.hero.stats);
  });

  it("grants retro points = level * pointsPerLevel to a v4 save missing stats", () => {
    const v4: Parameters<typeof migrate>[0] = {
      version: 4,
      stage: 3,
      gold: 10,
      hero: { cls: "archer", level: 8, xp: 1, tier: 1 },
    };
    const v5 = migrate(v4);
    expect(v5.version).toBe(SAVE_VERSION);
    expect(v5.hero.statPoints).toBe(8 * ST.pointsPerLevel);
    expect(v5.hero.stats).toEqual(baseStats("archer"));
  });

  it("does not re-grant points to an already-v5 save (idempotent)", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.heroes[0].statPoints = 5;
    const save = toSaveData(s);
    const migrated = migrate(save);
    expect(migrated.hero.statPoints).toBe(5);
    expect(migrated).toEqual(migrate(migrated));
  });
});
