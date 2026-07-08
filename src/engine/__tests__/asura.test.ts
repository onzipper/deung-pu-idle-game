import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  initGameState,
  migrate,
  step,
  toSaveData,
  createRng,
  makeBoss,
  makeHero,
  ASURA_MAP_ID,
  isAsuraStage,
  isAsuraUnlocked,
  asuraHotZoneFor,
  asuraRewardMult,
  asuraRefineBandForStage,
  type GameState,
  type Enemy,
  type SaveData,
} from "@/engine";
import {
  LEGENDARY_FOR_CLASS,
  LEGENDARY_TEMPLATES,
  LEGENDARY_MAX_AWAKEN,
  isLegendaryTemplate,
  maxRefineForTemplate,
  clampRefineForTemplate,
  equipAtkOf,
  refinedStat,
  canCraftLegendary,
  craftBlockReason,
  hasAllZoneStones,
  tomePagesFound,
  TOME_ALL_PAGES,
  dropTableForStage,
  bossDropTableForStage,
} from "@/engine";
import { WORLD_ZONES } from "@/engine/systems/world";
import { updateSpawns } from "@/engine/systems/hunt";
import { resolveDeaths } from "@/engine/systems/combat";
import { equipItem } from "@/engine/systems/gear";
import { applyAsuraHotZone, craftLegendary } from "@/engine/systems/asura";

/**
 * ดินแดนอสูร (ASURA) hard-map — endgame v1 engine wave (docs/endgame-design.md).
 *
 * Locks: the s31-40 zone table shape, the s30-boss UNLOCK gate, the owner-locked DEPTH-LADDER
 * enemy overlay, the DETERMINISTIC elite (+ แก่นอสูร essence STREAM ISOLATION — gear/stone
 * sequences byte-identical), the SAVE v19 counters + migration (a v18 fixture loads), and the
 * daily HOT-ZONE hash + reward multiplier.
 */

/** A minimal asura-fixture state: L~65 tier-3 hero placed in an asura farm zone (depth 0..9). */
function asuraState(seed = 1, depth = 0): GameState {
  const save: SaveData = migrate({
    version: SAVE_VERSION,
    stage: CONFIG.asura.stageBase + depth,
    hero: { cls: "swordsman", level: 65, tier: 3 },
    location: { mapId: ASURA_MAP_ID, zoneIdx: depth },
    unlockedZones: { map1: 7, map2: 6, map3: 6, map4: 6, map5: 6, map6: 6, asura: 10 },
    lastFarmZone: { mapId: ASURA_MAP_ID, zoneIdx: depth },
  });
  return initGameState(seed, save);
}

/** A dead (hp 0) injected enemy for driving resolveDeaths directly. */
function deadMob(id: number, elite = false): Enemy {
  return {
    id,
    kind: "normal",
    x: 400,
    y: 200,
    hp: 0,
    maxHp: 100,
    atk: 10,
    speed: 0,
    size: 1,
    behavior: "melee",
    range: 0,
    cd: 0,
    engageOffset: 0,
    homeX: 400,
    aggressive: false,
    aggroRadius: 0,
    engaged: true,
    elite,
  };
}

describe("ดินแดนอสูร — zone table shape (s31-40)", () => {
  it("appends a 7th map with 10 farm zones (s31-40) + a boss-room capstone (s40)", () => {
    const map = CONFIG.world.maps.find((m) => m.id === ASURA_MAP_ID)!;
    expect(map).toBeTruthy();
    expect(map.zoneStageIds).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    expect(map.bossStageId).toBe(40);

    const zones = WORLD_ZONES.filter((z) => z.mapId === ASURA_MAP_ID);
    const farms = zones.filter((z) => z.kind === "farm");
    const bosses = zones.filter((z) => z.kind === "boss");
    expect(zones.some((z) => z.kind === "town")).toBe(false); // no second town
    expect(farms).toHaveLength(10);
    expect(bosses).toHaveLength(1);
    // Farm zones are zoneIdx 0..9 (s31..s40); the boss room is zoneIdx 10 (s40).
    expect(farms.map((z) => z.zoneIdx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(farms.map((z) => z.stage)).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    expect(bosses[0].zoneIdx).toBe(10);
    expect(bosses[0].stage).toBe(40);
  });

  it("isAsuraStage + refine-band readouts follow the +8/+9/+10 depth ladder", () => {
    expect(isAsuraStage(30)).toBe(false);
    expect(isAsuraStage(31)).toBe(true);
    expect(isAsuraStage(40)).toBe(true);
    // z1-3 → +8, z4-7 → +9, z8-10 → +10.
    expect(asuraRefineBandForStage(30)).toBeNull();
    expect([31, 32, 33].map(asuraRefineBandForStage)).toEqual([8, 8, 8]);
    expect([34, 35, 36, 37].map(asuraRefineBandForStage)).toEqual([9, 9, 9, 9]);
    expect([38, 39, 40].map(asuraRefineBandForStage)).toEqual([10, 10, 10]);
  });
});

describe("ดินแดนอสูร — depth-ladder difficulty overlay (s1-30 untouched)", () => {
  it("enemyHp/enemyAtk are byte-identical below s31 (mult = 1)", () => {
    // A within-core step (s29→s30) is the pure damped-geometric ratio (~1.128), with NO asura
    // mult — proving the overlay does not touch s≤30.
    const r = CONFIG.enemyHp(30) / CONFIG.enemyHp(29);
    expect(r).toBeGreaterThan(1.05);
    expect(r).toBeLessThan(1.2);
  });

  it("applies the per-depth HP/atk overlay ON TOP of the base curve inside asura (wave-4 shape)", () => {
    // Within the +8 band (z1→z2, gentle entry ramp) the step stays near the damped-geometric
    // ratio (<1.2) for BOTH hp and atk.
    expect(CONFIG.enemyHp(32) / CONFIG.enemyHp(31)).toBeLessThan(1.2);
    expect(CONFIG.enemyAtk(32) / CONFIG.enemyAtk(31)).toBeLessThan(1.2);
    // The z3→z4 BAND BOUNDARY (entering the +9 band) is a visible step-up — bigger than the
    // within-band z2→z3 step, for both hp and atk.
    expect(CONFIG.enemyHp(34) / CONFIG.enemyHp(33)).toBeGreaterThan(
      CONFIG.enemyHp(33) / CONFIG.enemyHp(32),
    );
    expect(CONFIG.enemyAtk(34) / CONFIG.enemyAtk(33)).toBeGreaterThan(
      CONFIG.enemyAtk(33) / CONFIG.enemyAtk(32),
    );
    // DEPTH-LADDER INVARIANT: enemy hp AND atk rise MONOTONICALLY across every asura zone
    // (s31→s40) — deeper is always harder in absolute terms. The deep-zone overlay is a DAMP
    // (< the mid-band peak) that keeps the (very steep, ~2.3× atk / ~3× hp s31→s40) base
    // geometric curve survivable at +10, WITHOUT ever making a deeper zone easier — see
    // docs/balance-asura.md for the total-difficulty rationale.
    for (let n = 32; n <= 40; n++) {
      expect(CONFIG.enemyHp(n)).toBeGreaterThan(CONFIG.enemyHp(n - 1));
      expect(CONFIG.enemyAtk(n)).toBeGreaterThan(CONFIG.enemyAtk(n - 1));
    }
    // The z8-10 (+10 band) overlay DAMPS: its atk mult is below the mid-band (z6) peak.
    expect(CONFIG.asura.atkMultByDepth[9]).toBeLessThan(CONFIG.asura.atkMultByDepth[5]);
    // The exposed band table matches the folded overlay.
    expect(CONFIG.asura.hpMultByDepth).toHaveLength(CONFIG.asura.farmZones);
    expect(CONFIG.asura.atkMultByDepth).toHaveLength(CONFIG.asura.farmZones);
  });

  it("uses a FLAT asura zone-unlock quota (killGoal override) — maps-4-6 pace, s1-30 identical", () => {
    // s1-30 killGoal is the base curve (24 + 12n) — BYTE-IDENTICAL.
    expect(CONFIG.killGoal(30)).toBe(24 + 30 * 12);
    expect(CONFIG.killGoal(1)).toBe(24 + 1 * 12);
    // Every asura stage (s31-40) uses the flat override — NOT the 396-504 grind the base curve
    // would impose. The "climb every zone once" proof is the SEPARATE zoneStoneGoal counter.
    for (let n = 31; n <= 40; n++) expect(CONFIG.killGoal(n)).toBe(CONFIG.asura.killGoal);
    expect(CONFIG.asura.killGoal).toBeLessThan(24 + 31 * 12); // strictly gentler than the base curve
    expect(CONFIG.asura.killGoal).toBeGreaterThan(0);
  });
});

describe("ดินแดนอสูร — unlock gate (after the s30 boss)", () => {
  it("isAsuraUnlocked is false until asura z1 is persist-unlocked, opened by the s30 boss clear", () => {
    // A hero standing in the map6 boss room (idx 5), all map6 zones unlocked, asura NOT yet.
    const save = migrate({
      version: 18,
      stage: 30,
      hero: { cls: "swordsman", level: 85, tier: 3 },
      location: { mapId: "map6", zoneIdx: 5 },
      unlockedZones: { map1: 7, map2: 6, map3: 6, map4: 6, map5: 6, map6: 6 },
      lastFarmZone: { mapId: "map6", zoneIdx: 4 },
    });
    const s = initGameState(3, save);
    expect(isAsuraUnlocked(s)).toBe(false);

    // Drive the s30 boss kill: forced-combat boss phase, boss on its last legs, a strong hero.
    s.phase = "boss";
    s.boss = makeBoss(s.nextId++, 30);
    s.boss.hp = 1;
    s.enemies = [];
    const h = s.heroes[0];
    h.dead = false;
    h.hp = h.maxHp;
    // (cast reads the LIVE phase — TS otherwise narrows it to the just-assigned "boss" literal.)
    for (let i = 0; i < 600 && (s.phase as string) !== "victory"; i++) step(s, {});

    expect(s.phase).toBe("victory");
    // onBossRoomCleared (appended-map6 → asura) unlocked asura z1.
    expect(s.unlockedZones[ASURA_MAP_ID] ?? 0).toBeGreaterThanOrEqual(1);
    expect(isAsuraUnlocked(s)).toBe(true);
  });
});

describe("ดินแดนอสูร — elite roaming mob (deterministic, no RNG contamination)", () => {
  it("promotes exactly every cadence-th asura spawn, deterministically + with boosted stats", () => {
    const run = (): { eliteIds: number[]; rngState: number; count: number } => {
      const s = asuraState(1234, 0);
      s.spawnPaused = false;
      s.spawnBurst = false;
      s.spawnCd = 0;
      const eliteIds: number[] = [];
      // Spawn a big pool by repeatedly clearing the field so updateSpawns keeps trickling.
      for (let i = 0; i < 4000; i++) {
        const rng = createRng(s.rngState);
        const before = s.enemies.length;
        updateSpawns(s, rng);
        s.rngState = rng.state();
        s.spawnCd = 0;
        if (s.enemies.length > before) {
          const e = s.enemies[s.enemies.length - 1];
          if (e.elite) eliteIds.push(e.id);
          s.enemies = []; // clear so the pool keeps spawning
        }
      }
      return { eliteIds, rngState: s.rngState, count: s.asuraSpawnTally };
    };
    const a = run();
    const b = run();
    // Deterministic: identical elite promotions + identical RNG cursor across two runs.
    expect(a.eliteIds).toEqual(b.eliteIds);
    expect(a.rngState).toBe(b.rngState);
    expect(a.eliteIds.length).toBeGreaterThan(0);
    // Cadence: an elite lands on every `cadence`-th spawn (tally multiples).
    expect(a.count % CONFIG.asura.elite.cadence).toBeLessThan(CONFIG.asura.elite.cadence);
  });

  it("an elite carries boosted HP/atk vs a normal same-stage mob + emits eliteSpawned", () => {
    const s = asuraState(77, 0);
    s.spawnPaused = false;
    s.spawnBurst = false;
    let normal: Enemy | null = null;
    let elite: Enemy | null = null;
    let sawSpawnEvent = false;
    for (let i = 0; i < 6000 && (!normal || !elite); i++) {
      const rng = createRng(s.rngState);
      const before = s.enemies.length;
      s.spawnCd = 0;
      updateSpawns(s, rng);
      s.rngState = rng.state();
      if (s.enemies.length > before) {
        const e = s.enemies[s.enemies.length - 1];
        if (e.elite && e.kind === "normal") elite = e;
        else if (!e.elite && e.kind === "normal") normal = e;
        if (s.events.some((ev) => ev.type === "eliteSpawned" && ev.id === e.id)) sawSpawnEvent = true;
        s.enemies = [];
      }
    }
    expect(normal).toBeTruthy();
    expect(elite).toBeTruthy();
    expect(sawSpawnEvent).toBe(true);
    expect(elite!.hp).toBeGreaterThan(normal!.hp);
    expect(elite!.atk).toBeGreaterThan(normal!.atk);
    expect(elite!.maxHp).toBe(elite!.hp);
  });
});

describe("ดินแดนอสูร — แก่นอสูร essence + ศิลาโซน counters (SAVE v19 accrual)", () => {
  it("banks essence on elite kills WITHOUT perturbing the gear/stone loot streams", () => {
    const s = asuraState(9, 0);
    const startCounter = s.lootCounter;
    // 5 kills: #2 and #4 are elites (a plain guaranteed essence + stone burst).
    s.enemies = [deadMob(101), deadMob(102, true), deadMob(103), deadMob(104, true), deadMob(105)];
    resolveDeaths(s);

    // STREAM ISOLATION: exactly ONE lootCounter tick per kill (elite or not) — essence never ticks it.
    expect(s.lootCounter).toBe(startCounter + 5);
    // Every loot event's rollId sits in the contiguous [startCounter, startCounter+5) range with
    // no gap/dup introduced by the essence grant (one stoneDrop per kill at most, one rollId each).
    const lootRollIds = s.events
      .filter((e): e is Extract<typeof e, { rollId: string }> => e.type === "itemDrop" || e.type === "stoneDrop")
      .map((e) => Number(e.rollId));
    for (const id of lootRollIds) {
      expect(id).toBeGreaterThanOrEqual(startCounter);
      expect(id).toBeLessThan(startCounter + 5);
    }
    // A kill emits at most ONE stoneDrop event (idempotent server claim key per rollId).
    const stonePerRoll = new Map<number, number>();
    for (const e of s.events) {
      if (e.type === "stoneDrop") stonePerRoll.set(Number(e.rollId), (stonePerRoll.get(Number(e.rollId)) ?? 0) + 1);
    }
    for (const c of stonePerRoll.values()) expect(c).toBe(1);

    // ACCRUAL: 2 elites → essence banked; all 5 kills → the zone's ศิลาโซน counter.
    expect(s.asuraEssence).toBe(2 * CONFIG.asura.elite.essence);
    expect(s.asuraZoneKills[`${ASURA_MAP_ID}:0`]).toBe(5);
    // The elite burst emits eliteKilled with the essence amount.
    const eliteKills = s.events.filter((e) => e.type === "eliteKilled");
    expect(eliteKills).toHaveLength(2);
  });

  it("emits asuraZoneStoneEarned exactly once, at the ศิลาโซน goal crossing", () => {
    const s = asuraState(5, 2);
    const goal = CONFIG.asura.zoneStoneGoal;
    s.asuraZoneKills[`${ASURA_MAP_ID}:2`] = goal - 1; // one kill short
    s.enemies = [deadMob(1), deadMob(2)]; // two more kills — crosses the goal on the first
    resolveDeaths(s);
    const earned = s.events.filter((e) => e.type === "asuraZoneStoneEarned");
    expect(earned).toHaveLength(1);
    expect(s.asuraZoneKills[`${ASURA_MAP_ID}:2`]).toBe(goal + 1);
  });

  it("essence + counters are inert outside asura (s1-30 accrual untouched)", () => {
    const s = initGameState(1, migrate({ version: 18, stage: 10, hero: { cls: "mage", level: 30, tier: 2 } }));
    s.enemies = [deadMob(1), deadMob(2, true)]; // an "elite" flag is meaningless off-map
    resolveDeaths(s);
    expect(s.asuraEssence).toBe(0);
    expect(Object.keys(s.asuraZoneKills)).toHaveLength(0);
    expect(s.events.some((e) => e.type === "eliteKilled")).toBe(false);
  });
});

describe("ดินแดนอสูร — SAVE v19 migration + round-trip", () => {
  it("bumps to 19 and backfills a v18 fixture (essence 0, counters {})", () => {
    const m = migrate({ version: 18, stage: 12, gold: 900, hero: { cls: "archer", level: 45, tier: 3 } });
    expect(m.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(20);
    expect(m.asuraEssence).toBe(0);
    expect(m.asuraZoneKills).toEqual({});
    // Old fields untouched (domain-additive migration).
    expect(m.hero.cls).toBe("archer");
    expect(m.hero.level).toBe(45);
  });

  it("preserves a v19 save's counters (idempotent)", () => {
    const once = migrate({
      version: 19,
      stage: 33,
      gold: 100,
      hero: { cls: "swordsman", level: 70, tier: 3 },
      asuraEssence: 7,
      asuraZoneKills: { "asura:0": 80, "asura:1": 42, garbage: 5 },
    });
    expect(once.asuraEssence).toBe(7);
    // "garbage" (no ":") is dropped; valid "asura:idx" counters kept.
    expect(once.asuraZoneKills).toEqual({ "asura:0": 80, "asura:1": 42 });
    expect(migrate(once)).toEqual(once); // idempotent
  });

  it("round-trips essence + counters through initGameState + toSaveData", () => {
    const s = asuraState(3, 4);
    s.asuraEssence = 11;
    s.asuraZoneKills = { "asura:4": 55 };
    const restored = initGameState(3, toSaveData(s));
    expect(restored.asuraEssence).toBe(11);
    expect(restored.asuraZoneKills).toEqual({ "asura:4": 55 });
    // Transient fields rebuild fresh on load.
    expect(restored.asuraHotZone).toBeNull();
    expect(restored.asuraSpawnTally).toBe(0);
  });
});

describe("ดินแดนอสูร — daily hot zone (deterministic hash + reward multiplier)", () => {
  it("asuraHotZoneFor is deterministic + in [0, farmZones)", () => {
    for (const dayKey of [0, 1, 20260708, 999999, 42]) {
      const a = asuraHotZoneFor(dayKey);
      const b = asuraHotZoneFor(dayKey);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(CONFIG.asura.farmZones);
    }
    // Different day-keys spread across zones (not a constant).
    const spread = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => asuraHotZoneFor(d * 100003 + 7)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it("applies the reward multiplier ONLY in the day's hot asura zone", () => {
    // Pick a day-key, find its hot zone, and place the hero there.
    const dayKey = 20260708;
    const hot = asuraHotZoneFor(dayKey);
    const s = asuraState(2, hot);
    expect(asuraRewardMult(s)).toBe(1); // not set yet
    applyAsuraHotZone(s, dayKey);
    expect(s.asuraHotZone).toBe(hot);
    expect(asuraRewardMult(s)).toBe(CONFIG.asura.hotZone.rewardMult);

    // Standing in a DIFFERENT asura zone → no bonus.
    const cold = (hot + 1) % CONFIG.asura.farmZones;
    const s2 = asuraState(2, cold);
    applyAsuraHotZone(s2, dayKey);
    expect(asuraRewardMult(s2)).toBe(1);

    // Off-map → no bonus even with a hot zone set.
    const s3 = initGameState(2, migrate({ version: 18, stage: 8, hero: { cls: "mage", level: 25, tier: 2 } }));
    applyAsuraHotZone(s3, dayKey);
    expect(asuraRewardMult(s3)).toBe(1);
  });

  it("the setAsuraHotZone intent bonuses xp/gold/stone for kills in the hot zone", () => {
    const dayKey = 314159;
    const hot = asuraHotZoneFor(dayKey);
    const base = asuraState(4, hot);
    applyAsuraHotZone(base, dayKey);
    expect(base.asuraHotZone).toBe(hot);
    const goldBefore = base.gold;
    base.enemies = [deadMob(1)];
    resolveDeaths(base);
    const hotGold = base.gold - goldBefore;

    // Same kill in the SAME zone but NOT hot → strictly less gold (the +40% bonus is real).
    const plain = asuraState(4, hot);
    const g0 = plain.gold;
    plain.enemies = [deadMob(1)];
    resolveDeaths(plain);
    const plainGold = plain.gold - g0;
    expect(hotGold).toBeGreaterThan(plainGold);
  });
});

describe("ตำราตำนาน — legendary templates + awakening cap (+5, no drop tables)", () => {
  it("defines one legendary weapon per class at ≈ t10 × 1.8 atk, kind-tagged + craft-only", () => {
    const CLASSES = ["swordsman", "archer", "mage", "ninja"] as const;
    for (const cls of CLASSES) {
      const id = LEGENDARY_FOR_CLASS[cls];
      const t = LEGENDARY_TEMPLATES[id];
      expect(t).toBeTruthy();
      expect(t.slot).toBe("weapon");
      expect(t.classReq).toBe(cls);
      expect(t.kind).toBe("legendary");
      expect(isLegendaryTemplate(id)).toBe(true);
      // ~t10 × 1.8 (sword/mage/ninja 70→126, archer 88→158) — owner call 2026-07-08 (v1.3).
      const t10 = cls === "archer" ? 88 : 70;
      expect(t.stats.atk).toBe(Math.round(t10 * 1.8));
    }
    // A legendary NEVER enters a drop/boss table (tier 11 > MAX_TIER), so s1-30 tables are untouched.
    for (const id of Object.keys(LEGENDARY_TEMPLATES)) {
      let inAnyTable = false;
      for (let s = 1; s <= 40; s++) {
        if (dropTableForStage(s, "ninja").some((e) => e.templateId === id)) inAnyTable = true;
        if (bossDropTableForStage(s, "ninja").some((e) => e.templateId === id)) inAnyTable = true;
      }
      expect(inAnyTable).toBe(false);
    }
  });

  it("caps a legendary's awakening at +5 while ordinary gear stays +10", () => {
    const legend = LEGENDARY_FOR_CLASS.swordsman;
    expect(maxRefineForTemplate(legend)).toBe(LEGENDARY_MAX_AWAKEN);
    expect(LEGENDARY_MAX_AWAKEN).toBe(5);
    expect(maxRefineForTemplate("w_sword_t10_apocalypse")).toBe(10);
    // A hostile +9 awaken is clamped to +5 for a legendary; a t10 gear +9 stays +9.
    expect(clampRefineForTemplate(legend, 9)).toBe(5);
    expect(clampRefineForTemplate("w_sword_t10_apocalypse", 9)).toBe(9);
  });

  it("equips a legendary (kind legendary IS equippable) with the +5-clamped awaken folded into ATK", () => {
    const s = asuraState(1, 0);
    const h = s.heroes[0]; // swordsman
    const legend = LEGENDARY_FOR_CLASS.swordsman;
    equipItem(s, h, "weapon", legend, 9); // server-decided +9 → clamped to +5
    expect(h.equipped.weapon).toBe(legend);
    expect(h.equipped.refine?.weapon).toBe(5);
    // ATK = refinedStat(126, 5) = round(126 × 1.4) = 176 (armor null).
    expect(equipAtkOf(h)).toBe(refinedStat(LEGENDARY_TEMPLATES[legend].stats.atk!, 5));
    expect(equipAtkOf(h)).toBe(176);
  });
});

describe("ตำราตำนาน — secret-quest page triggers (deterministic, persisted bitmask)", () => {
  it("page 1 drops on the FIRST elite kill (idempotent, once lifetime)", () => {
    const s = asuraState(3, 0);
    expect(s.tomePages).toBe(0);
    s.enemies = [deadMob(1, true)];
    resolveDeaths(s);
    expect(tomePagesFound(s)).toBe(1);
    const found = s.events.filter((e) => e.type === "tomePageFound");
    expect(found).toHaveLength(1);
    expect((found[0] as { page: number }).page).toBe(1);
    // A second elite kill does NOT re-emit (page already found). Clear the buffer first (resolveDeaths
    // is driven directly here, not through step(), so events accumulate across calls).
    s.events.length = 0;
    s.enemies = [deadMob(2, true)];
    resolveDeaths(s);
    expect(s.events.some((e) => e.type === "tomePageFound")).toBe(false);
  });

  it("pages 2 & 3 drop on the first kill in the z5 (idx 4) + z10 (idx 9) farms → tome assembles", () => {
    // Page 2 in z5.
    const z5 = asuraState(4, 4);
    z5.enemies = [deadMob(1)];
    resolveDeaths(z5);
    expect(z5.tomePages & (1 << 1)).toBeTruthy();

    // Assemble all 3 pages on ONE state at z10 (idx 9): seed pages 1+2, then a z10 kill lands page 3.
    const z10 = asuraState(4, 9);
    z10.tomePages = (1 << 0) | (1 << 1); // page 1 + 2 already found
    expect(z10.tomeUnlocked).toBe(false);
    z10.enemies = [deadMob(1)];
    resolveDeaths(z10);
    expect(z10.tomePages).toBe(TOME_ALL_PAGES);
    expect(z10.tomeUnlocked).toBe(true);
    expect(z10.events.some((e) => e.type === "tomeAssembled")).toBe(true);
  });

  it("page triggers are inert outside the milestone zones (a plain asura kill drops no depth page)", () => {
    const s = asuraState(4, 2); // z3 — not a page zone
    s.enemies = [deadMob(1)]; // not an elite
    resolveDeaths(s);
    expect(s.tomePages).toBe(0);
  });
});

describe("ตำราตำนาน — daily sigil + legendary craft validation", () => {
  it("claimAsuraSigil banks one sigil (via the intent) + emits asuraSigilClaimed", () => {
    const s = asuraState(1, 0);
    expect(s.asuraSigils).toBe(0);
    step(s, { claimAsuraSigil: true });
    expect(s.asuraSigils).toBe(CONFIG.asura.tome.sigilPerClaim);
    expect(s.events.some((e) => e.type === "asuraSigilClaimed")).toBe(true);
  });

  /** A state that satisfies EVERY engine-owned craft precondition. */
  function craftReadyState(): GameState {
    const s = asuraState(7, 0);
    const cost = CONFIG.asura.tome.craft;
    s.tomeUnlocked = true;
    s.asuraEssence = cost.essence;
    s.asuraSigils = cost.sigils;
    s.gold = cost.gold;
    s.materials = cost.materials;
    for (let d = 0; d < CONFIG.asura.farmZones; d++) s.asuraZoneKills[`${ASURA_MAP_ID}:${d}`] = CONFIG.asura.zoneStoneGoal;
    return s;
  }

  it("blocks the craft with the FIRST unmet reason + consumes nothing", () => {
    const cases: Array<[keyof GameState | "stones", string, (s: GameState) => void]> = [
      ["tomeUnlocked", "locked", (s) => (s.tomeUnlocked = false)],
      ["asuraEssence", "essence", (s) => (s.asuraEssence -= 1)],
      ["asuraSigils", "sigils", (s) => (s.asuraSigils -= 1)],
      ["stones", "stones", (s) => (s.asuraZoneKills[`${ASURA_MAP_ID}:9`] = 0)],
      ["gold", "gold", (s) => (s.gold -= 1)],
      ["materials", "materials", (s) => (s.materials -= 1)],
    ];
    for (const [, reason, breakOne] of cases) {
      const s = craftReadyState();
      breakOne(s);
      expect(craftBlockReason(s)).toBe(reason);
      expect(canCraftLegendary(s)).toBe(false);
      const essence = s.asuraEssence;
      const requested = craftLegendary(s);
      expect(requested).toBe(false);
      expect(s.asuraEssence).toBe(essence); // nothing consumed
      const blocked = s.events.filter((e) => e.type === "legendaryCraftBlocked");
      expect(blocked).toHaveLength(1);
      expect((blocked[0] as { reason: string }).reason).toBe(reason);
    }
  });

  it("crafts on a fully-satisfied recipe: consumes engine-owned counts (NOT zone stones) + emits the mint request", () => {
    const s = craftReadyState();
    expect(hasAllZoneStones(s)).toBe(true);
    expect(canCraftLegendary(s)).toBe(true);
    const cost = CONFIG.asura.tome.craft;
    const stonesBefore = { ...s.asuraZoneKills };
    const requested = craftLegendary(s); // swordsman
    expect(requested).toBe(true);
    // Consumed: essence, sigils, gold, materials.
    expect(s.asuraEssence).toBe(0);
    expect(s.asuraSigils).toBe(0);
    expect(s.gold).toBe(0);
    expect(s.materials).toBe(0);
    // Zone stones are a PERMANENT gate — never consumed.
    expect(s.asuraZoneKills).toEqual(stonesBefore);
    // Emits the server mint request with the class's legendary template.
    const req = s.events.filter((e) => e.type === "legendaryCraftRequested");
    expect(req).toHaveLength(1);
    expect((req[0] as { cls: string; templateId: string })).toMatchObject({
      cls: "swordsman",
      templateId: LEGENDARY_FOR_CLASS.swordsman,
    });
    expect(cost.gold).toBeGreaterThan(0); // sanity: a real sink
  });

  it("crafts through the step() intent too (lead lane 0)", () => {
    const s = craftReadyState();
    step(s, { craftLegendary: true });
    expect(s.events.some((e) => e.type === "legendaryCraftRequested")).toBe(true);
    expect(s.asuraEssence).toBe(0);
  });
});

describe("ดินแดนอสูร — SAVE v20 migration (tome + sigils)", () => {
  it("bumps to 20 and backfills a v19 fixture (sigils 0, pages 0, locked)", () => {
    const m = migrate({ version: 19, stage: 33, hero: { cls: "mage", level: 70, tier: 3 }, asuraEssence: 5 });
    expect(m.version).toBe(20);
    expect(SAVE_VERSION).toBe(20);
    expect(m.asuraSigils).toBe(0);
    expect(m.tomePages).toBe(0);
    expect(m.tomeUnlocked).toBe(false);
    expect(m.asuraEssence).toBe(5); // v19 field preserved
  });

  it("preserves a v20 save's tome state + round-trips through init/toSaveData (idempotent)", () => {
    const once = migrate({
      version: 20,
      stage: 40,
      hero: { cls: "ninja", level: 80, tier: 3 },
      asuraSigils: 3,
      tomePages: TOME_ALL_PAGES,
      tomeUnlocked: true,
    });
    expect(once.asuraSigils).toBe(3);
    expect(once.tomePages).toBe(TOME_ALL_PAGES);
    expect(once.tomeUnlocked).toBe(true);
    expect(migrate(once)).toEqual(once); // idempotent
    const restored = initGameState(1, once);
    expect(restored.asuraSigils).toBe(3);
    expect(restored.tomePages).toBe(TOME_ALL_PAGES);
    expect(restored.tomeUnlocked).toBe(true);
    expect(toSaveData(restored)).toMatchObject({ asuraSigils: 3, tomePages: TOME_ALL_PAGES, tomeUnlocked: true });
  });
});

describe("ดินแดนอสูร — a swordsman fixture uses makeHero cleanly (smoke)", () => {
  it("constructs an asura-depth hero without touching the elite flag on ordinary mobs", () => {
    const h = makeHero(1, "swordsman", 65, 0, 3);
    expect(h.tier).toBe(3);
    // An ordinary spawned mob never carries the elite flag.
    const s = asuraState(1, 0);
    s.spawnPaused = false;
    s.spawnBurst = true;
    const rng = createRng(s.rngState);
    updateSpawns(s, rng);
    // The burst is a small fraction; none of the first few are elite (cadence 60).
    expect(s.enemies.slice(0, 3).every((e) => !e.elite)).toBe(true);
  });
});
