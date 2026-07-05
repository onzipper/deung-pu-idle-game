import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  CONFIG,
  HERO_TYPES,
  zoneAt,
  sign,
  type Enemy,
  type GameState,
} from "@/engine";

const HERO_MELEE_RANGE = HERO_TYPES.swordsman.range;
import { updateEnemies } from "@/engine/systems/combat";
import { zoneSpawnParams } from "@/engine/systems/waves";
import { applyDamage } from "@/engine/systems/damage";
import { makeStubEnemy, soloSave, worldAutopilot } from "./helpers";

/**
 * M6 combat rework — "สนามล่ามอน" (open-field mob hunting, decided 2026-07-05).
 *
 * Replaces the forward-march wave model (old charge.test.ts): a per-zone spawn
 * POOL scatters mobs across the field, the hero AUTO-HUNTS the nearest one, and
 * mobs are PASSIVE by default (fight back only when hit) with an AGGRESSIVE belt
 * that thickens toward the boss room. These pin the required behaviours headlessly.
 */

/** A passive melee mob that CAN hurt the hero once engaged (real atk, ready cd). */
function passiveMob(id: number, x: number): Enemy {
  return { ...makeStubEnemy(id, x, 1_000_000), engaged: false, aggressive: false, atk: 10, cd: 0, speed: 44 };
}

/** An aggressive mob with a given aggro radius (starts un-engaged). */
function aggressiveMob(id: number, x: number, aggroRadius: number): Enemy {
  return {
    ...makeStubEnemy(id, x, 1_000_000),
    engaged: false,
    aggressive: true,
    aggroRadius,
    atk: 10,
    cd: 0,
    speed: 44,
  };
}

describe("spawn pool (M6)", () => {
  it("bursts to the map's maxAlive on entry, scattered across the field", () => {
    const s = initGameState(1);
    step(s, {}); // one step: burst fill
    const sp = zoneSpawnParams(zoneAt(s.location));
    expect(s.enemies.length).toBe(sp.maxAlive);
    const xs = s.enemies.map((e) => e.x);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(sp.spawnMinX - 1e-6);
      expect(x).toBeLessThanOrEqual(sp.spawnMaxX + 1e-6);
    }
    // Genuinely spread out (not stacked on one spawn edge).
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
  });

  it("is spawn-DETERMINISTIC: same seed => identical kinds + positions", () => {
    const a = initGameState(4242);
    const b = initGameState(4242);
    step(a, {});
    step(b, {});
    const shape = (s: GameState) => s.enemies.map((e) => `${e.kind}:${e.x.toFixed(4)}:${e.aggressive}`);
    expect(shape(a)).toEqual(shape(b));
  });

  it("respawns to refill the pool after the field is wiped", () => {
    const s = initGameState(1);
    step(s, {}); // fill
    expect(s.enemies.length).toBeGreaterThan(0);
    s.enemies = []; // wipe
    let refilled = false;
    for (let i = 0; i < 300 && !refilled; i++) {
      step(s, {});
      refilled = s.enemies.length > 0;
    }
    expect(refilled).toBe(true);
  });
});

describe("temperament (M6)", () => {
  it("a PASSIVE mob never initiates — an un-hit hero takes no damage", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    hero.x = 214;
    const mob = passiveMob(1, 264); // close enough to attack IF it were aggressive
    s.enemies = [mob];
    const hp0 = hero.hp;

    for (let i = 0; i < 600; i++) updateEnemies(s); // drive ONLY the enemy AI

    expect(hero.hp).toBe(hp0); // never attacked
    expect(mob.engaged).toBe(false); // still idle
    // It only WANDERED around its spawn point (never charged the hero).
    expect(Math.abs(mob.x - mob.homeX)).toBeLessThanOrEqual(CONFIG.hunt.wanderAmp + 1);
  });

  it("a PASSIVE mob RETALIATES once hit (engages + fights back)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    hero.x = 214;
    const mob = passiveMob(1, 264);
    s.enemies = [mob];

    applyDamage(s, mob, 5, "attack"); // the hero's strike lands
    expect(mob.engaged).toBe(true);

    const hp1 = hero.hp;
    for (let i = 0; i < 600; i++) updateEnemies(s);
    expect(hero.hp).toBeLessThan(hp1); // now it closes in and hits back
  });

  it("an AGGRESSIVE mob engages when the hero enters its aggro radius (emits mobAggroed)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    hero.x = 214;
    const mob = aggressiveMob(1, 214 + 120, 130); // inside 130
    s.enemies = [mob];

    updateEnemies(s);
    expect(mob.engaged).toBe(true);
    expect(s.events.some((e) => e.type === "mobAggroed" && e.id === 1)).toBe(true);
  });

  it("an AGGRESSIVE mob outside its radius stays idle (no aggro)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    hero.x = 214;
    const mob = aggressiveMob(1, 214 + 300, 130); // 300 > 130
    s.enemies = [mob];

    for (let i = 0; i < 60; i++) updateEnemies(s);
    expect(mob.engaged).toBe(false);
  });
});

describe("aggro belt density ramps toward the boss room (M6)", () => {
  it("the aggressive fraction rises across a map and across maps", () => {
    const frac = (mapId: string, zoneIdx: number) =>
      zoneSpawnParams(zoneAt({ mapId, zoneIdx })).aggroFraction;

    // map1 (has a town at zoneIdx 0): first farm zone is fully passive, ramping up.
    expect(frac("map1", 1)).toBe(0); // stage 1, first farm
    expect(frac("map1", 5)).toBeGreaterThan(frac("map1", 1)); // stage 5, last farm before boss
    // Monotonic non-decreasing across map1's farm zones.
    for (let z = 2; z <= 5; z++) expect(frac("map1", z)).toBeGreaterThanOrEqual(frac("map1", z - 1));
    // Later maps are more dangerous (no town offset: last farm = zoneIdx 4).
    expect(frac("map2", 4)).toBeGreaterThan(frac("map1", 5)); // map2 last farm > map1 last farm
    expect(frac("map3", 4)).toBeGreaterThan(frac("map2", 4));
    // M6 hunt-density retune: aggro FRACTIONS were cut when maxAlive rose ~2.5×
    // (0.15-0.25 on map3), so the ABSOLUTE aggressive-mob count per zone still rose
    // vs the old 6-8-cap field without turning the belt into a meat grinder.
    expect(frac("map3", 4)).toBeGreaterThanOrEqual(0.25); // ~25% at the last frontier farm

  });
});

describe("hero auto-hunt (M6)", () => {
  it("walks to the nearest mob and closes to melee reach", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    const startX = hero.x;
    // A single stationary mob far to the right: the hero must walk to it.
    s.enemies = [makeStubEnemy(1, startX + 300, 1_000_000)];

    for (let i = 0; i < 400; i++) step(s, {});
    // Reached striking distance (melee range) of the mob.
    expect(Math.abs(s.enemies[0].x - hero.x)).toBeLessThanOrEqual(HERO_MELEE_RANGE);
    expect(hero.x).toBeGreaterThan(startX + 150);
  });

  it("does NOT ping-pong between two equidistant mobs — commits to one (deterministic tie-break)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    const startX = hero.x;
    // Two stationary, harmless (atk 0) mobs equidistant on opposite sides.
    s.enemies = [
      makeStubEnemy(1, startX - 200, 1_000_000), // lower id -> the tie-break winner
      makeStubEnemy(2, startX + 200, 1_000_000),
    ];

    let dirChanges = 0;
    let prevDir = 0;
    for (let i = 0; i < 400; i++) {
      const before = hero.x;
      step(s, {});
      const d = sign(hero.x - before);
      if (d !== 0 && prevDir !== 0 && d !== prevDir) dirChanges++;
      if (d !== 0) prevDir = d;
    }
    // It picked the lower-id (left) mob and marched there — no oscillation livelock.
    expect(hero.x).toBeLessThan(startX);
    expect(dirChanges).toBeLessThanOrEqual(1);
  });

  it("target selection + movement are deterministic under a full sim", () => {
    const a = initGameState(77, soloSave("archer", 3));
    const b = initGameState(77, soloSave("archer", 3));
    for (let i = 0; i < 2000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(JSON.stringify(a.heroes[0])).toBe(JSON.stringify(b.heroes[0]));
    expect(JSON.stringify(a.enemies)).toBe(JSON.stringify(b.enemies));
  });
});

describe("anti-stall (M6)", () => {
  it("a pure-farm hunt never livelocks — kills grow every segment (hero always reaches a mob)", () => {
    // No walking: the hero stays in zone 1 and just hunts. If the auto-hunt ever
    // livelocked (ping-pong, unreachable mob, respawn starvation) kills would flatline.
    const s = initGameState(9, soloSave("swordsman", 1));
    s.autoCast = true;
    // Defaults ON (like real play): death -> town -> auto-return keeps the farm loop
    // alive. In the M6-density field an unsustained level-1 melee can go down, and
    // arriveAtZone resets s.kills, so tally kill EVENTS (as the long-run test does)
    // to prove hunting keeps PRODUCING kills — the real anti-livelock signal.
    s.autoReturn = true;
    let total = 0;
    let last = 0;
    for (let seg = 0; seg < 8; seg++) {
      for (let i = 0; i < 1200; i++) {
        step(s, {}); // ~20s/segment
        for (const e of s.events) if (e.type === "kill") total++;
      }
      expect(total).toBeGreaterThan(last);
      last = total;
    }
  });

  it("a long autopilot run progresses across the world without freezing", () => {
    const s = initGameState(9, soloSave("swordsman", 1));
    s.autoCast = true;
    s.autoReturn = true;
    let totalKills = 0; // s.kills resets per zone, so tally kill EVENTS instead
    for (let i = 0; i < 60 * 400; i++) {
      step(s, worldAutopilot(s)); // ~400s
      for (const e of s.events) if (e.type === "kill") totalKills++;
    }
    expect(totalKills).toBeGreaterThan(200); // sustained hunting throughout
    expect(s.stage).toBeGreaterThan(1); // genuinely advanced out of zone 1
    expect(zoneAt(s.location).kind).not.toBe("boss"); // not wedged mid boss room
  });
});
