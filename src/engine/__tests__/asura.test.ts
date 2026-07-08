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
import { WORLD_ZONES } from "@/engine/systems/world";
import { updateSpawns } from "@/engine/systems/hunt";
import { resolveDeaths } from "@/engine/systems/combat";
import { applyAsuraHotZone } from "@/engine/systems/asura";

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

  it("applies the per-depth HP/atk multiplier ON TOP of the base curve inside asura", () => {
    // Within a band (z1→z2, both hp-mult 1.0) the step is the plain damped-geometric ratio (<1.2).
    expect(CONFIG.enemyHp(32) / CONFIG.enemyHp(31)).toBeLessThan(1.2);
    // Across the z7→z8 band jump (hp-mult 1.4 → 1.75) the step is visibly BIGGER than geometric.
    expect(CONFIG.enemyHp(38) / CONFIG.enemyHp(37)).toBeGreaterThan(1.2);
    // atk mult jump z2→z3 (1.0 → 1.05) nudges the atk step above the pure geometric one.
    expect(CONFIG.enemyAtk(33) / CONFIG.enemyAtk(32)).toBeGreaterThan(
      CONFIG.enemyAtk(32) / CONFIG.enemyAtk(31),
    );
    // The exposed band table matches the folded overlay.
    expect(CONFIG.asura.hpMultByDepth).toHaveLength(CONFIG.asura.farmZones);
    expect(CONFIG.asura.atkMultByDepth).toHaveLength(CONFIG.asura.farmZones);
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
    expect(SAVE_VERSION).toBe(19);
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
