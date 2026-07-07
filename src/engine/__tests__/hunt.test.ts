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
import { makeHero } from "@/engine";
import { updateEnemies, updateHeroes } from "@/engine/systems/combat";
import { zoneSpawnParams } from "@/engine/systems/hunt";
import { applyDamage, applyAoeDamage } from "@/engine/systems/damage";
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
  it("gradual re-entry fill: bursts only a fraction on entry, then trickles up to the cap", () => {
    const s = initGameState(1);
    step(s, {}); // one step: PARTIAL burst (not the full swarm)
    const sp = zoneSpawnParams(zoneAt(s.location));
    const seed = Math.max(1, Math.ceil(sp.maxAlive * CONFIG.hunt.reentryBurstFrac));
    expect(s.enemies.length).toBe(seed);
    expect(seed).toBeLessThan(sp.maxAlive); // genuinely a ramp, not an instant re-swarm
    const xs0 = s.enemies.map((e) => e.x);
    for (const x of xs0) {
      expect(x).toBeGreaterThanOrEqual(sp.spawnMinX - 1e-6);
      expect(x).toBeLessThanOrEqual(sp.spawnMaxX + 1e-6);
    }
    expect(Math.max(...xs0) - Math.min(...xs0)).toBeGreaterThan(40); // scattered
    // The respawn cadence refills the field all the way up to the alive-field cap.
    let maxSeen = s.enemies.length;
    for (let i = 0; i < 60 * 25; i++) {
      step(s, {});
      maxSeen = Math.max(maxSeen, s.enemies.length);
    }
    expect(maxSeen).toBe(sp.maxAlive);
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

describe("survivor-retaliation rule (M7.7)", () => {
  const HP0 = 1_000_000;

  it("every passive that SURVIVES a skill AoE engages; a cluster it one-shots stays silent", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    // A tight passive cluster fully inside the blast — all take the hit and SURVIVE.
    const survivors = [0, 1, 2, 3, 4, 5].map((i) => passiveMob(i + 1, 400 + i * 6));
    s.enemies = survivors;
    applyAoeDamage(s, s.enemies, 415, 90, 5, "skill"); // 5 dmg vs 1e6 hp: all live
    expect(survivors.every((m) => m.hp === HP0 - 5)).toBe(true); // all damaged
    expect(survivors.every((m) => m.engaged)).toBe(true); // ...all retaliate (no cap)

    // A cluster the blast KILLS outright never engages (it's removed this step).
    const s2 = initGameState(1);
    s2.spawnPaused = true;
    const doomed = [0, 1, 2].map((i) => ({ ...passiveMob(i + 10, 400 + i * 6), hp: 4, maxHp: 4 }));
    s2.enemies = doomed;
    applyAoeDamage(s2, s2.enemies, 406, 90, 5, "skill"); // 5 dmg kills all (hp 4)
    expect(doomed.every((m) => m.hp <= 0)).toBe(true); // killed
    expect(doomed.every((m) => !m.engaged)).toBe(true); // killed -> no retaliation
  });

  it("a mob that survives one drop but dies to another: killed = not engaged", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const tough = passiveMob(1, 400); // 1e6 hp -> survives, engages
    const frail = { ...passiveMob(2, 406), hp: 3, maxHp: 3 }; // dies -> stays silent
    s.enemies = [tough, frail];
    applyAoeDamage(s, s.enemies, 403, 90, 5, "skill");
    expect(tough.engaged).toBe(true);
    expect(frail.hp).toBeLessThanOrEqual(0);
    expect(frail.engaged).toBe(false);
  });

  it("does not draw from the RNG — survivor-retaliation is byte-identical on replay", () => {
    const run = (): string => {
      const s = initGameState(55);
      s.spawnPaused = true;
      s.enemies = [0, 1, 2, 3].map((i) => passiveMob(i + 1, 380 + i * 10));
      applyAoeDamage(s, s.enemies, 400, 80, 4, "skill");
      return JSON.stringify(s.enemies);
    };
    expect(run()).toBe(run());
  });
});

describe("min-spacing spawn placement (M6 hunt follow-up)", () => {
  it("a filled field is spread out — no two mobs stacked on a point", () => {
    // best-candidate placement keeps each spawn away from the nearest existing mob,
    // so even a dense (17-21) M7.7 field never STACKS mobs on a point. The packed
    // field legitimately runs tighter than the M6 15-mob one, so the "no exact stack"
    // floor is a couple px (sprites are wider — this only guards against coincident x).
    for (const seed of [1, 2, 3, 42]) {
      const s = initGameState(seed);
      for (let i = 0; i < 60 * 20; i++) step(s, {});
      const xs = [...s.enemies.map((e) => e.x)].sort((a, b) => a - b);
      let minGap = Infinity;
      for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
      expect(minGap).toBeGreaterThan(2); // no coincident spawn (not a hard-spacing guarantee)
    }
  });

  it("placement stays deterministic (same seed => identical positions)", () => {
    const a = initGameState(321);
    const b = initGameState(321);
    for (let i = 0; i < 400; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.enemies.map((e) => e.x)).toEqual(b.enemies.map((e) => e.x));
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
    // M7.7: aggro FRACTIONS were trimmed again (map3 0.15-0.25 → 0.10-0.16) because
    // survivor-retaliation + the denser 17/19/21-mob fields add their own heat — the
    // belt stays the danger source without becoming a meat grinder (esp. for the
    // self-swarming archer; map2 kept low to keep it 0-death-safe).
    expect(frac("map3", 4)).toBeGreaterThanOrEqual(0.15); // ~16% at the frontier tail

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

/**
 * Kite smoothness (game-feel regression, 2026-07): a ranged hero fleeing a mob that
 * has stabilised at the kite distance used to STUTTER — the old `h.x - dir*kiteStep`
 * lunge over-shot the `kiteDist` threshold ~2.9px, then held for ~2 frames while the
 * mob closed the gap, then lunged again (a 20Hz stop-start = owner-reported "ตัวเด้ง ๆ").
 * The fix servos the kite goal to a fixed target-relative distance (`tgt.x - dir*kiteDist`),
 * so the per-step move-clamp glides continuously. These pin that headlessly.
 */
describe("kite smoothness (ranged flee, no jitter)", () => {
  function chaserMob(id: number, x: number, speed: number): Enemy {
    return { ...makeStubEnemy(id, x, 1_000_000), engaged: true, aggressive: false, atk: 5, cd: 999, speed };
  }

  for (const cls of ["archer", "mage"] as const) {
    it(`${cls} kiting a chasing mob retreats smoothly — no per-step oscillation or stutter`, () => {
      const s = initGameState(1);
      s.heroes = [makeHero(1, cls)];
      s.nextId = 100;
      s.autoHunt = true;
      const h = s.heroes[0];
      h.x = 400;
      // A single mob to the RIGHT, walking left at well under huntSpeed so the hero
      // CAN hold the kite band (this is the case the mob pins the hero at `kiteDist`).
      s.enemies = [chaserMob(200, 700, 55)];

      // Warm up until the mob has driven the hero into the kite band (dist ≈ kiteDist).
      for (let i = 0; i < 220; i++) {
        updateEnemies(s);
        updateHeroes(s);
      }
      expect(Math.abs(s.enemies[0].x - h.x)).toBeLessThan(CONFIG.kiteDist + 5);

      // Now measure 120 kite-band steps.
      let prevX = h.x;
      let prevDir = 0;
      let flips = 0;
      let holdFramesWhileCrowded = 0;
      for (let i = 0; i < 120; i++) {
        updateEnemies(s);
        updateHeroes(s);
        const dx = h.x - prevX;
        const dir = dx > 1e-6 ? 1 : dx < -1e-6 ? -1 : 0;
        if (dir !== 0 && prevDir !== 0 && dir !== prevDir) flips++;
        if (dir !== 0) prevDir = dir;
        // A "hold frame" (|dx|≈0) WHILE a mob sits inside the kite band is the stutter
        // signature — a smooth servo moves a little every frame instead.
        const crowded = Math.abs(s.enemies[0].x - h.x) <= CONFIG.kiteDist + 1e-3;
        if (crowded && dir === 0) holdFramesWhileCrowded++;
        prevX = h.x;
      }
      // The fleeing hero never reverses direction (no bounce)...
      expect(flips).toBe(0);
      // ...and never stop-starts inside the kite band (no lunge/hold stutter).
      expect(holdFramesWhileCrowded).toBe(0);
    });
  }
});
