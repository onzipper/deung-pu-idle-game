import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  initGameState,
  step,
  toSaveData,
  heroPlaneY,
  planeYForDepth,
  stepPlaneY,
} from "@/engine";
import type { Enemy } from "@/engine";
import { stateHash } from "@/engine/lockstep/stateHash";
import { FIXED_DT } from "@/engine/core/loop";
import { soloSave, makeParty, forceBoss } from "./helpers";

/**
 * R4 Wave C1 — HERO y steering. Hero `planeY` becomes MUTABLE per step: a hero eases its
 * depth-row toward the lane of the ENEMY it is engaging, else back to its stateless home row
 * (idle / walking / boss & world-boss fights). Enemies/boss/worldBoss stay STATIC. The steering
 * is COSMETIC by construction — `planeY` is never read by targeting/range/cooldown/skills, so it
 * can never gate an attack. These tests pin: the pure ease math, determinism, convergence without
 * overshoot, idle/boss return-to-home, and the IRON invariant that y gates no combat timing.
 */

const DT = FIXED_DT;
const YSPEED = CONFIG.plane.ySpeed;
const EPS = CONFIG.plane.yArriveEps;
const NEAR = CONFIG.plane.bandNear; // 40 (downstage row)
const FAR = CONFIG.plane.bandFar; // -24 (upstage row)

/** A stationary, always-engaged melee stub with a controlled depth row. speed/atk 0 so it never
 * moves or deals damage — the only thing that changes is what the hero does around it. */
function engagedEnemyAt(id: number, x: number, planeY: number, hp = 1_000_000): Enemy {
  return {
    id,
    kind: "normal",
    x,
    y: 200,
    hp,
    maxHp: hp,
    atk: 0,
    speed: 0,
    size: 1,
    behavior: "melee",
    range: 0,
    cd: 999,
    engageOffset: 0,
    homeX: x,
    aggressive: false,
    aggroRadius: 0,
    engaged: true,
    planeY,
  };
}

// ---------------------------------------------------------------------------
// The pure ease helper (systems/plane.stepPlaneY)
// ---------------------------------------------------------------------------

describe("stepPlaneY — pure per-step plane ease", () => {
  it("moves at most ySpeed×dt toward the target (clamped)", () => {
    const maxStep = YSPEED * DT; // 2 units/step
    expect(stepPlaneY(0, 100, DT)).toBeCloseTo(maxStep, 12); // huge gap → clamp up
    expect(stepPlaneY(100, 0, DT)).toBeCloseTo(100 - maxStep, 12); // clamp down
  });

  it("lands EXACTLY on the target once the gap is within one step (no overshoot)", () => {
    // gap 1 (< maxStep 2, > eps) → clamp is identity → exactly the target
    expect(stepPlaneY(0, 1, DT)).toBe(1);
  });

  it("SNAPS to the target within arrive-eps and then holds (no oscillation)", () => {
    // within eps → snaps to target
    expect(stepPlaneY(0, EPS * 0.5, DT)).toBe(EPS * 0.5);
    // at target → stays (delta 0 ≤ eps)
    expect(stepPlaneY(5, 5, DT)).toBe(5);
  });

  it("converges monotonically to the target and never overshoots it", () => {
    let y: number = FAR;
    let prev = -Infinity;
    for (let i = 0; i < 200; i++) {
      y = stepPlaneY(y, NEAR, DT);
      expect(y).toBeGreaterThanOrEqual(prev); // non-decreasing toward a higher target
      expect(y).toBeLessThanOrEqual(NEAR + 1e-9); // never past the target
      prev = y;
    }
    expect(y).toBeCloseTo(NEAR, 9); // arrived
  });
});

// ---------------------------------------------------------------------------
// Wired into combat — engage / idle / boss / determinism
// ---------------------------------------------------------------------------

describe("hero y steering — engagement convergence", () => {
  it("a hero engaging a farm mob eases its planeY to that mob's lane, no overshoot", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [engagedEnemyAt(500, 200, NEAR)]; // near-row mob
    const home = heroPlaneY("swordsman");
    expect(s.heroes[0].planeY).toBe(home); // spawns on the solo home row (17.6)
    expect(home).not.toBe(NEAR); // meaningfully different lanes

    let prev = home - 1e-9;
    let reached = -1;
    for (let i = 0; i < 60; i++) {
      step(s, {});
      const y = s.heroes[0].planeY!;
      expect(y).toBeGreaterThanOrEqual(prev); // monotone toward the near-row mob
      expect(y).toBeLessThanOrEqual(NEAR + 1e-9); // never overshoots the mob's lane
      if (reached < 0 && Math.abs(y - NEAR) < 1e-9) reached = i;
      prev = y;
    }
    // ~ (40 − 17.6)/2 ≈ 12 steps to close the gap at ySpeed.
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(20);
    // Held at the mob's lane once arrived — no chatter.
    step(s, {});
    expect(s.heroes[0].planeY).toBeCloseTo(NEAR, 9);
  });
});

describe("hero y steering — idle / walk returns to the home row", () => {
  it("solo: after the target is gone the hero eases back to its class formation row", () => {
    const s = initGameState(2, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [engagedEnemyAt(500, 200, NEAR)];
    for (let i = 0; i < 30; i++) step(s, {}); // converge to the mob's near row
    expect(s.heroes[0].planeY).toBeCloseTo(NEAR, 9);

    s.enemies = []; // target gone → idle → steer HOME (stateless recompute)
    const home = heroPlaneY("swordsman");
    let prev = Infinity;
    for (let i = 0; i < 60; i++) {
      step(s, {});
      const y = s.heroes[0].planeY!;
      expect(y).toBeLessThanOrEqual(prev + 1e-9); // monotone back down to home
      prev = y;
    }
    expect(s.heroes[0].planeY).toBeCloseTo(home, 9);
  });

  it("party: each idle hero returns to its OWN cohort-slot home row", () => {
    const s = makeParty(11, 3);
    s.spawnPaused = true;
    s.enemies = [];
    const size = s.heroes.length; // 3
    for (let i = 0; i < 60; i++) step(s, {});
    for (let slot = 0; slot < size; slot++) {
      const h = s.heroes[slot];
      expect(h.planeY).toBeCloseTo(heroPlaneY(h.cls, slot, size), 9);
    }
    // Slots fan across distinct rows (min→max), proving each recomputes its own home.
    expect(s.heroes[0].planeY).toBeCloseTo(planeYForDepth(CONFIG.plane.heroBandMin), 9);
    expect(s.heroes[2].planeY).toBeCloseTo(planeYForDepth(CONFIG.plane.heroBandMax), 9);
    expect(s.heroes[0].planeY!).toBeLessThan(s.heroes[2].planeY!);
  });
});

describe("hero y steering — boss phase holds/returns HOME (never adopts boss.planeY)", () => {
  it("during a boss fight the hero steers to its home row, not the boss's near row", () => {
    const s = initGameState(3, soloSave("swordsman", 3));
    s.spawnPaused = true;
    forceBoss(s); // phase → boss, boss stamped on the near/downstage row, field cleared
    const bossRow = s.boss!.planeY!;
    expect(bossRow).toBeCloseTo(NEAR, 9); // boss stamped on the near/downstage row

    const home = heroPlaneY("swordsman");
    // Start the hero ON the boss's near row so a (wrong) "steer to boss" would HOLD at NEAR,
    // while the correct home-steer must pull it DOWN toward the solo formation row.
    s.heroes[0].planeY = NEAR;

    for (let i = 0; i < 40; i++) step(s, {});
    const y = s.heroes[0].planeY!;
    expect(y).toBeCloseTo(home, 6); // returned home
    expect(y).toBeLessThan(bossRow - 1); // decisively NOT the boss's lane
  });
});

describe("hero y steering — IRON invariant: y gates NO combat", () => {
  // Run the identical engage scenario with the hero forced ALIGNED vs MAX-separated from the
  // target's lane; the first-hit tick and the kill tick must be byte-identical (proves range/
  // cooldown/target selection never read planeY).
  const runTimed = (heroYInit: number): { firstHit: number; kill: number } => {
    const s = initGameState(9, soloSave("swordsman", 3));
    s.spawnPaused = true;
    const hx = s.heroes[0].x;
    const e = engagedEnemyAt(777, hx, NEAR, 40); // same x → in melee range immediately
    s.enemies = [e];
    s.heroes[0].planeY = heroYInit;
    let firstHit = -1;
    let kill = -1;
    for (let i = 0; i < 900; i++) {
      step(s, {});
      const mob = s.enemies.find((m) => m.id === 777);
      if (firstHit < 0 && mob && mob.hp < mob.maxHp) firstHit = i;
      if (kill < 0 && !mob) {
        kill = i;
        break;
      }
    }
    return { firstHit, kill };
  };

  it("first-attack + kill ticks are identical whether the hero is aligned or max-separated in y", () => {
    const aligned = runTimed(NEAR); // hero on the mob's own lane
    const separated = runTimed(FAR); // hero a full band away
    expect(aligned.firstHit).toBeGreaterThanOrEqual(0); // a hit landed (tick 0 is valid)
    expect(aligned.kill).toBeGreaterThan(aligned.firstHit);
    expect(separated).toEqual(aligned); // byte-identical combat timing
  });

  it("an enemy in x-range but at MAX y-separation is attacked on the same tick as an aligned one", () => {
    // This is the same proof from the range angle: max |Δy| does not delay the first hit.
    expect(runTimed(FAR).firstHit).toBe(runTimed(NEAR).firstHit);
  });
});

describe("hero y steering — determinism + hash + save", () => {
  it("planeY trajectories are byte-identical across two same-seed runs", () => {
    const run = (): number[] => {
      const s = initGameState(7, soloSave("swordsman", 3));
      const traj: number[] = [];
      for (let i = 0; i < 150; i++) {
        step(s, {});
        traj.push(s.heroes[0].planeY!);
      }
      return traj;
    };
    expect(run()).toEqual(run());
  });

  it("stateHash is deterministic across runs with steering active", () => {
    const run = (): number => {
      const s = initGameState(42, soloSave("archer", 3));
      for (let i = 0; i < 300; i++) step(s, {});
      return stateHash(s);
    };
    expect(run()).toBe(run());
  });

  it("steering-moved planeY stays TRANSIENT — no SAVE_VERSION bump, never persisted", () => {
    const s = initGameState(5, soloSave("swordsman", 3));
    for (let i = 0; i < 200; i++) step(s, {}); // hero planeY steers across the run
    expect(SAVE_VERSION).toBe(20);
    const saved = toSaveData(s);
    expect(JSON.stringify(saved)).not.toContain("planeY");
  });
});
