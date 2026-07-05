import { describe, it, expect } from "vitest";
import { initGameState, step, CONFIG, HERO_TYPES, heroAtkSpeed } from "@/engine";
import type { Enemy, GameState } from "@/engine";
import { updateEnemies, updateHeroes, updateProjectiles } from "@/engine/systems/combat";
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

/**
 * Playtest bug "มอนตีดาบฟรี" (monsters hit the swordsman for free): while he
 * sprint-charges he outran slow enemies, leaving them behind him in the old
 * asymmetric attack window's blind spot (80–96px back), where they plinked him
 * with no possible counter. Fixed structurally by (a) symmetric melee targeting
 * (hit the nearest foe within range on EITHER side) and (b) a rear contact reach
 * so a further-behind enemy re-approaches instead of free-hitting.
 */
describe("swordsman free-hit fix (มอนตีดาบฟรี)", () => {
  /** A stationary melee attacker that keeps swinging (huge HP, real cooldown). */
  const attacker = (id: number, x: number): Enemy => ({
    ...makeStubEnemy(id, x, 1_000_000),
    atk: 6,
    cd: 0.5,
  });

  it("surrounded by 2+ melee foes he is never idle — swings each cooldown and retaliates against BOTH", () => {
    const s = initGameState(1);
    s.waveGap = 1e9;
    const sword = s.heroes[0];
    const range = HERO_TYPES.swordsman.range; // 96

    // Two attackers wedged just behind him, past the OLD [-80] attack window but
    // inside his 96 melee reach. With the asymmetric window he could not target
    // anything behind -80; symmetric targeting lets him swing back at them.
    const e1 = attacker(1, sword.x - 85);
    const e2 = attacker(2, sword.x - 88);
    s.enemies = [e1, e2];
    expect(sword.x - e1.x).toBeLessThanOrEqual(range); // genuinely in melee range
    expect(sword.x - e1.x).toBeGreaterThan(-CONFIG.meleeTargetMinD); // past the old window

    let swings = 0;
    let tookDamage = false;
    const dur = 240; // ~4s (huge-HP foes stay alive the whole window)
    for (let i = 0; i < dur; i++) {
      const before = s.enemies.reduce((a, e) => a + e.hp, 0);
      const hpB = sword.hp;
      step(s, {});
      if (s.enemies.reduce((a, e) => a + e.hp, 0) < before) swings++;
      if (sword.hp < hpB) tookDamage = true;
    }

    // He is under fire from the surrounding pack...
    expect(tookDamage).toBe(true);
    // ...and is NEVER idle: he lands roughly one swing per attack cooldown across
    // the whole window (the old blind spot would have produced ZERO — nothing was
    // targetable on his back side, i.e. free hits).
    const expected = (dur * CONFIG.speeds[0]) / 60 / heroAtkSpeed("swordsman", s.upgrades);
    expect(swings).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
  });

  it("a straggler further behind than melee reach re-approaches instead of free-hitting", () => {
    const s = initGameState(1);
    s.waveGap = 1e9;
    const sword = s.heroes[0];
    // A slow straggler far behind the front line: under the POC's one-sided engage
    // test it plinked from out of reach forever. Now it must walk back toward the
    // line (its x INCREASES) until it re-enters melee contact.
    const straggler: Enemy = { ...makeStubEnemy(1, sword.x - 200, 1_000_000), atk: 6, cd: 0.5, speed: 40 };
    s.enemies = [straggler];
    const startX = straggler.x;
    let dealtDamage = false;
    let reEngaged = false;
    for (let i = 0; i < 600; i++) {
      const hpB = sword.hp;
      step(s, {});
      if (sword.hp < hpB) dealtDamage = true;
      if (sword.x - straggler.x <= HERO_TYPES.swordsman.range) reEngaged = true;
    }
    // It moved back toward the line (re-approach), not further away...
    expect(straggler.x).toBeGreaterThan(startX);
    // ...and got back into the swordsman's reach so any hit it lands is retaliable.
    expect(reEngaged).toBe(true);
    expect(dealtDamage).toBe(true);
  });
});

/**
 * Follow-up free-hit bug (ClickUp — live playtest): the swordsman STILL took free
 * hits despite 7bbdf35. Root cause found headlessly (see docs/balance-m4.md): a
 * RANGED-behaviour enemy anchors its 160-standoff to its NEAREST hero. When the
 * swordsman is walled at chargeHardCap (770) he becomes that nearest hero, so the
 * shooter parks at ~930 — past his 96 melee reach AND past the anchor-capped
 * backline's forward reach (archer ~834 / mage ~766) — plinking him with zero
 * possible counter while all three heroes stand unable to answer (BUG 1 + BUG 2).
 *
 * Fix: a shooter beyond EVERY alive hero's reach HOLDS FIRE and creeps in
 * (rangedReengageSpeed) until a hero can answer it; ranged heroes fall back to an
 * either-side in-range target when they have nothing forward, so they engage a
 * flanking attacker instead of idling.
 */
describe("ranged-enemy free-hit fix (มอนตีดาบฟรี — shooter beyond reach)", () => {
  /** Reach edge of each class relative to a pinned formation (for readability). */
  const walled = (s: GameState) => {
    const sword = s.heroes.find((h) => h.cls === "swordsman")!;
    const archer = s.heroes.find((h) => h.cls === "archer")!;
    const mage = s.heroes.find((h) => h.cls === "mage")!;
    // The exact walled formation the sim produces: swordsman deep at chargeHardCap,
    // ranged heroes at their anchor-capped homes (anchor 510 + offsets).
    sword.x = CONFIG.chargeHardCap; // 770
    archer.x = 510 + HERO_TYPES.archer.offset; // 484
    mage.x = 510 + HERO_TYPES.mage.offset; // 436
    return { sword, archer, mage };
  };

  it("BUG 1: a shooter beyond every hero's reach never lands a free hit — it holds fire and creeps in until answerable", () => {
    const s = initGameState(1, threeHeroSave(3));
    const { sword } = walled(s);
    s.projectiles = [];
    // Ranged shooter past ALL reach edges: > 866 (sword+96), > 834 (archer+350),
    // > 766 (mage+330). This is the exact configuration that free-hit the swordsman.
    const shooter: Enemy = {
      ...makeStubEnemy(999, 950, 1_000_000),
      kind: "ranged",
      behavior: "ranged",
      range: 160,
      speed: 32,
      atk: 6,
      cd: 0, // wants to fire immediately
    };
    s.enemies = [shooter];

    const reachEdge = sword.x + HERO_TYPES.swordsman.range; // 866
    let firedWhileBeyond = false;
    let reached = false;
    // Drive ONLY the enemy update so the heroes stay pinned in the walled formation
    // (isolates the enemy rule from hero movement); this is the scenario in which the
    // old code plinked forever.
    for (let i = 0; i < 4000; i++) {
      const prevX = shooter.x;
      updateEnemies(s);
      if (shooter.x > reachEdge) {
        // Beyond reach: MUST hold fire (no bolt spawned) and creep inward.
        if (s.projectiles.length > 0) firedWhileBeyond = true;
        expect(shooter.x).toBeLessThan(prevX); // always closing, never plinking from afar
      } else {
        reached = true;
        break;
      }
    }
    // It never dealt an un-answerable hit...
    expect(firedWhileBeyond).toBe(false);
    // ...and it is NOT an immortal wall — it closes into a fair fight (the swordsman
    // can now strike it symmetrically), so the wave still resolves.
    expect(reached).toBe(true);
    expect(Math.abs(shooter.x - sword.x)).toBeLessThanOrEqual(HERO_TYPES.swordsman.range);
  });

  it("BUG 1 (integration): under a full sim the swordsman is never free-hit by an unreachable shooter", () => {
    const s = initGameState(1, threeHeroSave(3));
    s.waveGap = 1e9;
    // A wall of tanky melee grunts pins the swordsman forward at chargeHardCap, and a
    // tanky shooter trails behind them at the spawn edge — the live-play setup.
    for (let i = 0; i < 4; i++) {
      s.enemies.push({ ...makeStubEnemy(10 + i, 840 + i * 20, 1_000_000), speed: 30, atk: 5, cd: 0.5 });
    }
    const shooter: Enemy = {
      ...makeStubEnemy(999, 1000, 1_000_000),
      kind: "ranged",
      behavior: "ranged",
      range: 160,
      speed: 32,
      atk: 8,
      cd: 0,
    };
    s.enemies.push(shooter);

    // Invariant: on no step may the shooter fire a bolt while it is beyond every
    // hero's reach. We detect a fired bolt via the projectileSpawn event and check the
    // geometry at that instant.
    let freeBolt = false;
    for (let i = 0; i < 1800; i++) {
      step(s, {});
      const alive = s.heroes.filter((h) => !h.dead);
      const boltFired = s.events.some(
        (e) => e.type === "projectileSpawn" && e.kind === "bolt",
      );
      if (boltFired) {
        const canAnswer = alive.some((h) => {
          const t = HERO_TYPES[h.cls];
          const d = shooter.x - h.x;
          return t.attack === "melee" ? Math.abs(d) <= t.range : d >= 0 && d <= t.range;
        });
        if (!canAnswer) freeBolt = true;
      }
    }
    expect(freeBolt).toBe(false);
    // The shooter is eventually answered (it took damage), proving it's not a stall.
    expect(shooter.hp).toBeLessThan(shooter.maxHp);
  });

  it("BUG 2: ranged heroes engage an in-range attacker on their flank instead of idling", () => {
    const s = initGameState(1, threeHeroSave(3));
    walled(s);
    // Reposition the backline shallow so a flank foe is inside their range; keep the
    // swordsman forward (charged). A foe BEHIND both ranged heroes but within both
    // ranges: forward-only targeting would leave archer & mage idle — the fallback
    // makes them answer it.
    const archer = s.heroes.find((h) => h.cls === "archer")!;
    const mage = s.heroes.find((h) => h.cls === "mage")!;
    archer.x = 484;
    mage.x = 436;
    const foe: Enemy = { ...makeStubEnemy(1, 300, 1_000_000) }; // behind both, within 350/330
    expect(foe.x).toBeLessThan(mage.x); // genuinely behind the backline (not forward)
    s.enemies = [foe];
    s.projectiles = [];

    // Ready every hero to attack this step, then run the hero update in isolation.
    for (const h of s.heroes) h.cd = 0;
    let sawArrow = false;
    let sawOrb = false;
    for (let i = 0; i < 200; i++) {
      updateHeroes(s);
      if (s.projectiles.some((p) => p.kind === "arrow")) sawArrow = true;
      if (s.projectiles.some((p) => p.kind === "orb")) sawOrb = true;
      updateProjectiles(s); // let the volley + orb travel and resolve onto the foe
    }
    // BOTH ranged heroes acquired the flank attacker (archer volley + mage orb)...
    expect(sawArrow).toBe(true);
    expect(sawOrb).toBe(true);
    // ...and it is actually taking damage (answered, not ignored).
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });
});
