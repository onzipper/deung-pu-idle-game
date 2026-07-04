import { describe, it, expect } from "vitest";
import { initGameState, step, CONFIG, HERO_TYPES } from "@/engine";
import type { Enemy, GameState } from "@/engine";
import { makeStubEnemy, threeHeroSave } from "./helpers";

// The swordsman stops `meleeApproachGap` short and his home slot rides ahead, so
// allow generous slack when asserting he "reached" the enemy line.
const HERO_STRIKE_SLACK = 120;

/** A moving melee enemy (real speed) that walks in from the spawn edge. */
function makeWalkingEnemy(id: number, x: number, speed = 44, hp = 100000): Enemy {
  return { ...makeStubEnemy(id, x, hp), speed, atk: 5, cd: 0.5 };
}

/** A ranged enemy that stops at range 160 of the nearest hero and plinks it. */
function makeRangedEnemy(id: number, x: number, hp = 100000): Enemy {
  return {
    ...makeStubEnemy(id, x, hp),
    kind: "ranged",
    behavior: "ranged",
    range: 160,
    speed: 32,
    atk: 5,
    cd: 0.5,
  };
}

/** Front-most (largest x) living hero's x. */
const frontHeroX = (s: GameState): number =>
  Math.max(...s.heroes.filter((h) => !h.dead).map((h) => h.x));

/**
 * Charge behaviour (ClickUp 86d3k2he0 -> 86d3k2nhm): the swordsman must RUN AT and
 * SMASH enemies instead of holding formation and waiting for them to walk in, and
 * the whole team must push forward AT ALL TIMES — never standing around at wave
 * start and never retreating between waves.
 *
 * 86d3k2nhm follow-up (playtest fixes): the forward cap is now DYNAMIC — it follows
 * the charge target up to `chargeHardCap` (770) instead of freezing at a static
 * `chargeCap`, and `battleMaxAnchor` rose to 590 so archer/mage coverage travels with
 * the deeper fight. This killed two bugs: (2) the swordsman parking mid-field while
 * enemies walked in, and (3) ranged enemies resting beyond his reach dealing free hits.
 */
describe("hero charge", () => {
  it("swordsman sprints DEEP across the field at a distant enemy (past the old 470 cap)", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    expect(sword.cls).toBe("swordsman");
    const startX = sword.x; // baseAnchor + offset = 214

    // A fat, stationary enemy far to the right: well past the old midCap (400) /
    // old chargeCap (470) hold, but reachable within the charge cap so he can
    // actually close to striking distance.
    s.enemies.push(makeStubEnemy(999, 700, 100000));

    for (let i = 0; i < 240; i++) step(s, {}); // ~4s

    // He ran a long way forward...
    expect(sword.x).toBeGreaterThan(startX + 200);
    // ...past where the OLD (470) charge cap could ever place him — proving the
    // deeper charge now that the anchor follows...
    expect(sword.x).toBeGreaterThan(470);
    // ...but respected the dynamic cap's ceiling (never sprints into the spawn edge)...
    expect(sword.x).toBeLessThanOrEqual(CONFIG.chargeHardCap);
    // ...and closed on the enemy (within melee striking distance).
    expect(700 - sword.x).toBeLessThan(HERO_STRIKE_SLACK);
  });

  it("charge is fast: the swordsman covers most of the gap within ~1.5s", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    const startX = sword.x;
    s.enemies.push(makeStubEnemy(999, 520, 100000));

    for (let i = 0; i < 90; i++) step(s, {}); // ~1.5s

    // chargeSpeed (265) > heroMove (150): in 1.5s a pure sprint covers ~397px.
    // Even net of the approach easing he should have crossed well past midCap fast.
    expect(sword.x).toBeGreaterThan(startX + 150);
  });

  it("advances PROMPTLY when a wave spawns — no idle window at wave start", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    const startX = sword.x;

    // A freshly-spawned enemy at the spawn edge (spawnX 860). With the whole-field
    // seek range it is charged instantly — the swordsman must NOT stand and wait
    // for it to walk into a tight range first.
    s.enemies.push(makeStubEnemy(999, CONFIG.spawnX, 100000));

    for (let i = 0; i < 30; i++) step(s, {}); // ~0.5s only

    // Within half a second he has already surged a long way forward (0.5s of
    // chargeSpeed 265 is ~132px; assert a clear, immediate advance).
    expect(sword.x).toBeGreaterThan(startX + 80);
  });

  it("does NOT retreat between waves — the team holds its forward line during a waveGap", () => {
    const s = initGameState(1);

    // Push the formation forward with an enemy on the field.
    s.enemies.push(makeStubEnemy(999, 600, 100000));
    for (let i = 0; i < 180; i++) step(s, {}); // ~3s: anchor rides up to its forward line
    const forwardAnchor = s.anchorX;
    expect(forwardAnchor).toBeGreaterThan(CONFIG.baseAnchor + 100); // genuinely pushed up

    // Wave cleared: no enemies, but still mid-stage (phase "battle") and no new
    // wave for a long time. The anchor must HOLD, not ease back toward base.
    s.enemies = [];
    s.waveGap = 100000;
    expect(s.phase).toBe("battle");
    for (let i = 0; i < 180; i++) step(s, {}); // ~3s of waveGap

    // No retreat: the forward line is held (allow a hair of float slack).
    expect(s.anchorX).toBeGreaterThanOrEqual(forwardAnchor - 1e-6);
  });

  it("with no enemy in charge range the swordsman holds near his home slot", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    // Hold the wave system off so the field stays empty: no charge target ->
    // the anchor holds its (base) line and the swordsman holds his slot.
    s.waveGap = 100000;
    for (let i = 0; i < 240; i++) step(s, {});
    // Stays within the tight hold band (never runs off toward the spawn edge).
    expect(sword.x).toBeLessThanOrEqual(CONFIG.midCap);
  });
});

/**
 * 86d3k2nhm follow-up — three playtested bugs, each pinned by a headless test.
 */
describe("formation + engagement follow-up (86d3k2nhm)", () => {
  // --- Symptom 1: archer & mage stood exactly stacked ("มองไม่เห็นตัวละคร") ---
  it("ranged heroes keep formation spacing at ANY anchor depth (no stacking)", () => {
    // A few enemy depths so the anchor settles at a range of forward lines,
    // including the deepest (battleMaxAnchor) where the old midCap(400) collapsed
    // archer(484) and mage(436) both onto 400.
    for (const enemyX of [500, 650, 800, CONFIG.spawnX]) {
      const s = initGameState(1, threeHeroSave(3)); // all 3 classes unlocked
      s.waveGap = 100000; // no new waves; a single held enemy pushes the anchor
      s.enemies.push(makeStubEnemy(999, enemyX, 100000));

      for (let i = 0; i < 480; i++) step(s, {}); // ~8s: anchor rides fully up

      const archer = s.heroes.find((h) => h.cls === "archer")!;
      const mage = s.heroes.find((h) => h.cls === "mage")!;
      const gap = Math.abs(archer.x - mage.x);
      // Never overlap in normal play...
      expect(gap).toBeGreaterThanOrEqual(30);
      // ...and the spread tracks the configured offset difference (-26 vs -74 = 48).
      const offsetSpread =
        HERO_TYPES.archer.offset - HERO_TYPES.mage.offset; // 48
      expect(gap).toBeGreaterThan(offsetSpread - 8);
      expect(gap).toBeLessThan(offsetSpread + 8);
    }
  });

  // --- Symptom 2: heroes park and wait while monsters walk in ("ยืนรอ...เซ็ง") ---
  it("swordsman does not stand idle while a live enemy walks in from spawn", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    s.waveGap = 100000; // isolate: only our injected walker
    s.enemies.push(makeWalkingEnemy(999, CONFIG.spawnX, 44)); // normal-speed melee

    const range = HERO_TYPES.swordsman.range; // 96
    let idleFrames = 0;
    let prevX = sword.x;
    for (let i = 0; i < 600; i++) {
      step(s, {}); // ~10s
      if (s.enemies.length === 0) break; // enemy dead -> nothing left to wait on
      const enemy = s.enemies[0];
      const outOfMelee = enemy.x - sword.x > range;
      const moved = Math.abs(sword.x - prevX);
      // "Idle" = essentially zero x-velocity WHILE an enemy is alive and beyond
      // his melee reach. That is precisely the park the player hated.
      if (outOfMelee && moved < 0.3) idleFrames++;
      prevX = sword.x;
    }
    // Under the old static chargeCap(640) he froze there for ~4s (~240 frames)
    // while the enemy crossed 860 -> ~686. Allow a small transient only.
    expect(idleFrames).toBeLessThan(60); // < ~1.0s
  });

  // --- Symptom 3: heroes take hits "for free" ("โดนมอนตีฟรี") ---
  it("swordsman can always close to melee range of a ranged enemy (no free hits)", () => {
    const s = initGameState(1);
    s.waveGap = 100000;
    // A ranged enemy at the spawn edge: it stops within range 160 of the nearest
    // hero and plinks. Under the old chargeCap(640) it rested ~800, 160px away >
    // 96 melee range, and the pinned swordsman could NEVER reach it -> free hits.
    const ranged = makeRangedEnemy(999, CONFIG.spawnX, 100000);
    s.enemies.push(ranged);

    const swordRange = HERO_TYPES.swordsman.range; // 96
    let minGap = Infinity;
    let dealtDamage = false;
    const startHp = ranged.hp;
    for (let i = 0; i < 900; i++) {
      step(s, {}); // ~15s
      if (s.enemies.length === 0) {
        dealtDamage = true; // reached + killed it
        minGap = 0;
        break;
      }
      const e = s.enemies[0];
      minGap = Math.min(minGap, e.x - frontHeroX(s));
      if (e.hp < startHp) dealtDamage = true;
    }
    // Structural guarantee: he gets within striking distance...
    expect(minGap).toBeLessThanOrEqual(swordRange);
    // ...and actually retaliates (the enemy is not an untouchable free-hitter).
    expect(dealtDamage).toBe(true);
  });
});
