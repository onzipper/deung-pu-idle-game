import { describe, it, expect } from "vitest";
import { CONFIG } from "@/engine";
import { WORLD_ZONES } from "@/engine/systems/world";
import { zoneSpawnParams } from "@/engine/systems/hunt";
import { makeBoss } from "@/engine/entities";

/**
 * M7.9 "Grand Expansion" — engine world foundation (maps 4/5/6 → stages s16-s30).
 *
 * These lock the STRUCTURE of the new content (6 zones per map, correct stage ids,
 * boss rooms) and the MONOTONICITY of the parametric curves through s30. The curves
 * themselves are the SAME functions maps 1-3 use, so s1-15 is untouched (guarded by
 * the existing suites); here we only assert the extension is sane + rising.
 */

const NEW_MAPS = ["map4", "map5", "map6"] as const;
const NEW_MAP_STAGES: Record<string, number[]> = {
  map4: [16, 17, 18, 19, 20],
  map5: [21, 22, 23, 24, 25],
  map6: [26, 27, 28, 29, 30],
};

describe("M7.9 world structure: maps 4/5/6", () => {
  it("adds exactly three new maps following the maps-1-3 formula", () => {
    const ids = CONFIG.world.maps.map((m) => m.id);
    // ดินแดนอสูร (endgame v1) appends a 7th map "asura" after map6 — the core s16-30 structure
    // this suite locks is unchanged (maps 1-6 in order); asura's own structure is covered in
    // asura.test.ts.
    expect(ids).toEqual(["map1", "map2", "map3", "map4", "map5", "map6", "asura"]);
  });

  for (const mapId of NEW_MAPS) {
    it(`${mapId} = 5 farm zones + 1 boss room, no second town`, () => {
      const zones = WORLD_ZONES.filter((z) => z.mapId === mapId);
      // No town outside map1.
      expect(zones.some((z) => z.kind === "town")).toBe(false);
      const farms = zones.filter((z) => z.kind === "farm");
      const bosses = zones.filter((z) => z.kind === "boss");
      expect(farms).toHaveLength(5);
      expect(bosses).toHaveLength(1);
      // Farm content stages match the theme block, in order.
      expect(farms.map((z) => z.stage)).toEqual(NEW_MAP_STAGES[mapId]);
      // Boss room sits at the last farm stage (the map's bossStageId).
      const cfg = CONFIG.world.maps.find((m) => m.id === mapId)!;
      expect(cfg.bossStageId).toBe(NEW_MAP_STAGES[mapId][4]);
      expect(bosses[0].stage).toBe(cfg.bossStageId);
      // Last zone is the boss room.
      expect(zones[zones.length - 1].kind).toBe("boss");
    });
  }

  it("stages 16-30 are all addressable as farm zones", () => {
    for (let stage = 16; stage <= 30; stage++) {
      const farm = WORLD_ZONES.find((z) => z.kind === "farm" && z.stage === stage);
      expect(farm, `stage ${stage} farm zone`).toBeDefined();
    }
  });
});

describe("M7.9 curves extend monotonically through s30", () => {
  it("killGoal / enemyHp / enemyAtk / bossHp / bossAtk rise every stage s16-30", () => {
    for (let n = 16; n <= 30; n++) {
      expect(CONFIG.killGoal(n)).toBeGreaterThan(CONFIG.killGoal(n - 1));
      expect(CONFIG.enemyHp(n)).toBeGreaterThan(CONFIG.enemyHp(n - 1));
      expect(CONFIG.enemyAtk(n)).toBeGreaterThan(CONFIG.enemyAtk(n - 1));
      expect(CONFIG.bossHp(n)).toBeGreaterThan(CONFIG.bossHp(n - 1));
      expect(CONFIG.bossAtk(n)).toBeGreaterThan(CONFIG.bossAtk(n - 1));
    }
  });

  it("gold / xp rewards rise every stage s16-30", () => {
    for (let n = 16; n <= 30; n++) {
      expect(CONFIG.goldPerKill(n)).toBeGreaterThanOrEqual(CONFIG.goldPerKill(n - 1));
      expect(CONFIG.goldPerBoss(n)).toBeGreaterThan(CONFIG.goldPerBoss(n - 1));
      expect(CONFIG.leveling.xpPerKill(n)).toBeGreaterThan(CONFIG.leveling.xpPerKill(n - 1));
      expect(CONFIG.leveling.xpPerBossKill(n)).toBeGreaterThan(CONFIG.leveling.xpPerBossKill(n - 1));
    }
  });

  it("every s16-30 curve value is finite (no NaN/Infinity)", () => {
    for (let n = 16; n <= 30; n++) {
      for (const v of [
        CONFIG.killGoal(n),
        CONFIG.enemyHp(n),
        CONFIG.enemyAtk(n),
        CONFIG.bossHp(n),
        CONFIG.bossAtk(n),
        CONFIG.goldPerKill(n),
        CONFIG.goldPerBoss(n),
        CONFIG.leveling.xpPerKill(n),
        CONFIG.leveling.xpPerBossKill(n),
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("s30 is a soft-wall: notably steeper than s15 but not a hard cliff", () => {
    // Geometric HP steepens toward the frontier — s30 should dwarf s15 (a real
    // wall) without being an unbounded blow-up (finite, sane multiplier).
    const ratio = CONFIG.bossHp(30) / CONFIG.bossHp(15);
    expect(ratio).toBeGreaterThan(5); // a genuine wall (≈15×)
    expect(ratio).toBeLessThan(50); // not an absurd cliff
  });
});

describe("M7.9 leveling / xp", () => {
  it("raises the level cap to 90", () => {
    expect(CONFIG.leveling.levelCap).toBe(90);
  });

  it("xpToLevel stays strictly increasing + finite through the new cap", () => {
    for (let lvl = 2; lvl <= CONFIG.leveling.levelCap; lvl++) {
      const v = CONFIG.leveling.xpToLevel(lvl);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(CONFIG.leveling.xpToLevel(lvl - 1));
    }
  });
});

describe("M7.9 hunt / aggro belt continues the ramp across new maps", () => {
  const lastFarmFrac = (mapId: string) => {
    const farms = WORLD_ZONES.filter((z) => z.mapId === mapId && z.kind === "farm");
    return zoneSpawnParams(farms[farms.length - 1]).aggroFraction;
  };

  // M7.9 s16-30 rebalance (docs/balance-m79.md): the first-pass design continued the
  // aggressive belt ABOVE map3 (map4>map3>…), but at s16-30 the geometric enemyAtk is so
  // high that a map3-sized belt fraction was a death-spiral for the squishy classes (the
  // #aggressive × per-hit-burst product exploded). The belt was therefore TRIMMED to sit
  // BELOW map3's tail — danger at the frontier now comes from tougher mobs + the boss
  // soft-walls, not raw aggressive body count (the same "not a self-inflicted swarm" rule
  // map3 itself follows). The belt still RAMPS monotonically ACROSS the new maps (map4 →
  // map5 → map6), just from a lower floor.
  it("the aggressive fraction at each new map's last farm ramps map4 → map6, trimmed below map3", () => {
    expect(lastFarmFrac("map4")).toBeLessThan(lastFarmFrac("map3"));
    expect(lastFarmFrac("map5")).toBeGreaterThan(lastFarmFrac("map4"));
    expect(lastFarmFrac("map6")).toBeGreaterThan(lastFarmFrac("map5"));
    expect(lastFarmFrac("map6")).toBeLessThanOrEqual(lastFarmFrac("map3"));
  });

  it("aggro fraction stays within [0,1] and ramps within each new map", () => {
    for (const mapId of NEW_MAPS) {
      const farms = WORLD_ZONES.filter((z) => z.mapId === mapId && z.kind === "farm");
      let prev = -1;
      for (const z of farms) {
        const f = zoneSpawnParams(z).aggroFraction;
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
        expect(f).toBeGreaterThanOrEqual(prev); // monotonic non-decreasing
        prev = f;
      }
    }
  });
});

describe("M7.9 boss variety roster", () => {
  it("has a row for every boss room stage (maps 1-6)", () => {
    for (const stage of [5, 10, 15, 20, 25, 30]) {
      expect(CONFIG.bossVariety[stage], `bossVariety[${stage}]`).toBeDefined();
    }
  });

  it("keeps maps 1-3 bosses on Slam + Enrage only (old fights unchanged)", () => {
    for (const stage of [5, 10, 15]) {
      const row = CONFIG.bossVariety[stage];
      expect(row.hpScale).toBe(1);
      expect(row.atkScale).toBe(1);
      expect(row.behaviors).toEqual(["slam", "enrage"]);
    }
  });

  it("gives each new boss the base kit + one signature mechanic", () => {
    // Task spec: map4 s20 = CHARGE, map5 s25 = SUMMON, map6 s30 = FIELD HAZARD.
    const expected: Record<number, string> = { 20: "charge", 25: "summon", 30: "hazard" };
    for (const stage of [20, 25, 30]) {
      const row = CONFIG.bossVariety[stage];
      // First-pass SOFTENING (breachable by a max tier-3 hero; the raw curve past
      // the s15 wall is unwinnable + the mechanic adds pressure). Scale in (0, 1].
      expect(row.hpScale).toBeGreaterThan(0);
      expect(row.hpScale).toBeLessThanOrEqual(1);
      expect(row.atkScale).toBeGreaterThan(0);
      expect(row.atkScale).toBeLessThanOrEqual(1);
      expect(row.behaviors).toContain("slam");
      expect(row.behaviors).toContain("enrage");
      expect(row.behaviors).toContain(expected[stage]);
    }
  });

  it("new bosses derive stats from the curve × per-boss scale via makeBoss", () => {
    for (const stage of [20, 25, 30]) {
      const row = CONFIG.bossVariety[stage];
      const boss = makeBoss(1, stage);
      expect(boss.hp).toBe(Math.round(CONFIG.bossHp(stage) * row.hpScale));
      expect(boss.maxHp).toBe(boss.hp);
      expect(boss.atk).toBe(Math.round(CONFIG.bossAtk(stage) * row.atkScale));
      expect(boss.hp).toBeGreaterThan(0);
      // The variety runtime state is stamped + starts idle.
      expect(boss.variety?.behaviors).toEqual(row.behaviors);
      expect(boss.variety?.chargePhase).toBe("idle");
      expect(boss.variety?.hazardPhase).toBe("idle");
      expect(boss.variety?.summonsFired).toBe(0);
    }
  });
});
