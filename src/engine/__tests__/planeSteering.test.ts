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
const NEAR = CONFIG.plane.bandNear; // 56 (downstage row)
const FAR = CONFIG.plane.bandFar; // -64 (upstage row)

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
    // Free-field band: ~ (56 − 14)/2 ≈ 21 steps to close the gap at ySpeed.
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(30);
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

describe("hero y steering — free-field 2D manual x/y move command", () => {
  it("a live x/y MOVE command drives planeY toward command.y along the honest 2D line (past the home row)", () => {
    const s = initGameState(4, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 100;
    h.planeY = FAR;
    const home = heroPlaneY("swordsman");
    expect(home).not.toBe(NEAR); // home is a distinct lane from the commanded near row

    // Command a far-x, near-row move so the command stays live for many steps.
    step(s, { moveTo: { x: 850, y: NEAR } });
    let prev = FAR - 1e-9;
    let cleared = false;
    for (let i = 0; i < 600; i++) {
      step(s, {});
      if (!h.command) {
        cleared = true;
        break;
      }
      const y = h.planeY!;
      expect(y).toBeGreaterThanOrEqual(prev); // monotone toward the commanded NEAR row (not home)
      expect(y).toBeLessThanOrEqual(NEAR + 1e-9);
      prev = y;
    }
    expect(cleared).toBe(true);
    // planeY climbed PAST the home row all the way to the COMMANDED near lane — proof the move
    // command's y drove the row (home-steer alone would have stopped at the class formation row).
    expect(prev).toBeGreaterThan(home + 1);
    expect(h.planeY).toBe(NEAR); // snapped onto the exact commanded row on completion
  });

  it("after an x/y move completes, an idle hero HOLDS the tapped row (R4.5 Wave 1.1)", () => {
    const s = initGameState(6, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.planeY = FAR;
    const home = heroPlaneY("swordsman");
    expect(home).not.toBe(NEAR); // home is a distinct lane from the tapped near row

    // Short x hop with a near-row target: the honest 2D line completes, then idles.
    h.x = 300;
    step(s, { moveTo: { x: 304, y: NEAR } }); // walks the (4,120) line; both axes arrive together
    for (let i = 0; i < 300 && h.command; i++) step(s, {});
    expect(h.command).toBeNull();
    expect(h.planeYHold).toBe(NEAR); // the completed x/y move LATCHED the tapped row
    // Idle now → the hero HOLDS the tapped row (does NOT ease back home). Run it forward.
    for (let i = 0; i < 200; i++) step(s, {});
    expect(h.planeY).toBeCloseTo(NEAR, 6); // still on the tapped row many steps later
    expect(Math.abs(h.planeY! - home)).toBeGreaterThan(1); // decisively NOT the home row
  });

  it("a y ALREADY on the commanded row reduces the x/y move to the x-only move (byte-identical combat)", () => {
    // Honest additive-safety proof: when the hero's planeY already equals the command's y, the
    // y-arrival gate is satisfied from step 0, so the x/y command's LIFETIME — and thus the whole
    // move-suppresses-auto-attack window and the ensuing combat — is byte-identical to an x-only
    // command. (The IRON invariant above already proves range/cooldown/targeting never read
    // planeY; this proves the C2 y machinery adds no perturbation when y is satisfied.)
    const runTimed = (withY: boolean): { firstHit: number; kill: number; x: number } => {
      const s = initGameState(31, soloSave("swordsman", 3));
      s.spawnPaused = true;
      const hx = s.heroes[0].x;
      const e = engagedEnemyAt(555, hx, NEAR, 40); // in melee range immediately
      s.enemies = [e];
      s.heroes[0].planeY = NEAR; // ALREADY on the commanded row → y arrives instantly
      const cmd = withY ? { moveTo: { x: hx, y: NEAR } } : { moveTo: { x: hx } };
      let firstHit = -1;
      let kill = -1;
      for (let i = 0; i < 900; i++) {
        step(s, i === 0 ? cmd : {});
        const mob = s.enemies.find((m) => m.id === 555);
        if (firstHit < 0 && mob && mob.hp < mob.maxHp) firstHit = i;
        if (kill < 0 && !mob) {
          kill = i;
          break;
        }
      }
      return { firstHit, kill, x: s.heroes[0].x };
    };
    const withY = runTimed(true);
    expect(withY.firstHit).toBeGreaterThanOrEqual(0);
    expect(withY.kill).toBeGreaterThan(withY.firstHit);
    expect(withY).toEqual(runTimed(false)); // byte-identical to the x-only path
  });
});

// ---------------------------------------------------------------------------
// R4.5 Wave 1.1 — manual y HOLD (a completed moveTo{x,y} LATCHES the tapped row)
// ---------------------------------------------------------------------------

describe("manual y hold — R4.5 Wave 1.1", () => {
  /** Drive a hero through a completed x/y move so its `planeYHold` latches `y`. */
  function holdRow(s: ReturnType<typeof initGameState>, x: number, y: number): void {
    step(s, { moveTo: { x, y } });
    for (let i = 0; i < 400 && s.heroes[0].command; i++) step(s, {});
  }

  it("solo: a completed x/y move HOLDS the tapped row for many idle steps", () => {
    const s = initGameState(61, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 300;
    holdRow(s, 306, NEAR);
    expect(h.command).toBeNull();
    expect(h.planeYHold).toBe(NEAR);
    for (let i = 0; i < 400; i++) step(s, {}); // long idle — must not drift home
    expect(h.planeY).toBeCloseTo(NEAR, 6);
  });

  it("party: each idle hero HOLDS its own latched row (not its cohort home row)", () => {
    const s = makeParty(62, 3);
    s.spawnPaused = true;
    s.enemies = [];
    const size = s.heroes.length;
    // Latch every hero a full band away from its own home row.
    for (const h of s.heroes) h.planeYHold = FAR;
    for (let i = 0; i < 120; i++) step(s, {});
    for (let slot = 0; slot < size; slot++) {
      const h = s.heroes[slot];
      const home = heroPlaneY(h.cls, slot, size);
      expect(h.planeY).toBeCloseTo(FAR, 6); // held the latched row
      expect(Math.abs(h.planeY! - home)).toBeGreaterThan(1); // decisively NOT its home row
    }
  });

  it("an x-only move CLEARS the hold → the hero returns to its home row (pre-Wave-1.1)", () => {
    const s = initGameState(63, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    const home = heroPlaneY("swordsman");
    h.x = 300;
    holdRow(s, 306, NEAR); // latch NEAR
    expect(h.planeYHold).toBe(NEAR);
    // Now an x-ONLY move (NPC / gate / legacy tap) — must clear the hold on completion.
    step(s, { moveTo: { x: 500 } });
    for (let i = 0; i < 600 && h.command; i++) step(s, {});
    expect(h.command).toBeNull();
    expect(h.planeYHold).toBeUndefined(); // hold dropped by the x-only completion
    for (let i = 0; i < 200; i++) step(s, {}); // idle → ease HOME
    expect(h.planeY).toBeCloseTo(home, 6);
  });

  it("an ENGAGED farm mob overrides the hold; after it dies the hero returns to the HELD row (not home)", () => {
    const s = initGameState(64, soloSave("swordsman", 3));
    s.spawnPaused = true;
    const h = s.heroes[0];
    const home = heroPlaneY("swordsman");
    h.planeYHold = FAR; // latch the FAR row
    h.planeY = FAR;
    // Put a killable mob on the NEAR row in melee reach so the hero engages + peels to it.
    s.enemies = [engagedEnemyAt(880, h.x, NEAR, 30)];
    let sawMobLane = false;
    for (let i = 0; i < 900; i++) {
      step(s, {});
      if (s.enemies.length && Math.abs(h.planeY! - NEAR) <= EPS) sawMobLane = true;
      if (!s.enemies.length) break;
    }
    expect(sawMobLane).toBe(true); // the mob's lane WON while engaged (hold did not)
    // Mob dead → idle → return to the HELD row (FAR), NOT the home row.
    for (let i = 0; i < 200; i++) step(s, {});
    expect(h.planeY).toBeCloseTo(FAR, 6);
    expect(Math.abs(h.planeY! - home)).toBeGreaterThan(1);
  });

  it("boss phase with a hold set → the hero holds the tapped row, NEVER the boss's near row", () => {
    const s = initGameState(65, soloSave("swordsman", 3));
    s.spawnPaused = true;
    forceBoss(s);
    const bossRow = s.boss!.planeY!;
    expect(bossRow).toBeCloseTo(NEAR, 9);
    const h = s.heroes[0];
    h.planeYHold = FAR; // latched far-upstage row
    h.planeY = NEAR; // start ON the boss row so a wrong "hold at boss row" would be visible
    for (let i = 0; i < 60; i++) step(s, {});
    expect(h.planeY).toBeCloseTo(FAR, 6); // pulled to the HELD row
    expect(h.planeY!).toBeLessThan(bossRow - 1); // decisively NOT the boss's lane
  });

  it("a zone arrival CLEARS the hold → the hero starts the new zone on its home row", () => {
    const s = initGameState(66); // default start: map1 zone 1 (a farm zone)
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 300;
    holdRow(s, 306, NEAR);
    expect(h.planeYHold).toBe(NEAR);
    // Walk LEFT to the adjacent town (zone 0); the arrival (reviveHeroesFull) drops the hold.
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 0 } });
    expect(s.traveling).not.toBeNull(); // transit actually started (adjacent + reachable)
    for (let i = 0; i < 2000 && s.traveling; i++) step(s, {});
    expect(s.traveling).toBeNull();
    expect(h.planeYHold).toBeUndefined(); // hold cleared on zone arrival
  });

  it("combat timing is byte-identical whether a hold is set or not (y still gates nothing)", () => {
    const runTimed = (setHold: boolean): { firstHit: number; kill: number } => {
      const s = initGameState(67, soloSave("swordsman", 3));
      s.spawnPaused = true;
      const hx = s.heroes[0].x;
      s.enemies = [engagedEnemyAt(881, hx, NEAR, 40)];
      s.heroes[0].planeY = NEAR;
      if (setHold) s.heroes[0].planeYHold = FAR; // a live hold must not perturb combat
      let firstHit = -1;
      let kill = -1;
      for (let i = 0; i < 900; i++) {
        step(s, {});
        const mob = s.enemies.find((m) => m.id === 881);
        if (firstHit < 0 && mob && mob.hp < mob.maxHp) firstHit = i;
        if (kill < 0 && !mob) {
          kill = i;
          break;
        }
      }
      return { firstHit, kill };
    };
    const withHold = runTimed(true);
    expect(withHold.firstHit).toBeGreaterThanOrEqual(0);
    expect(withHold.kill).toBeGreaterThan(withHold.firstHit);
    expect(withHold).toEqual(runTimed(false)); // identical first-hit + kill ticks
  });

  it("planeY trajectories with an active hold are byte-identical across two runs", () => {
    const run = (): number[] => {
      const s = initGameState(68, soloSave("swordsman", 3));
      s.spawnPaused = true;
      s.enemies = [];
      s.heroes[0].x = 300;
      const traj: number[] = [];
      step(s, { moveTo: { x: 306, y: NEAR } });
      for (let i = 0; i < 300; i++) {
        step(s, {});
        traj.push(s.heroes[0].planeY!);
      }
      return traj;
    };
    expect(run()).toEqual(run());
  });

  it("stateHash folds planeYHold present-only (a set hold changes the hash; undefined is invisible)", () => {
    const s = initGameState(69, soloSave("swordsman", 3));
    const base = stateHash(s);
    s.heroes[0].planeYHold = undefined; // present but undefined → NOT folded (byte-identical)
    expect(stateHash(s)).toBe(base);
    s.heroes[0].planeYHold = FAR; // a real hold DOES change the hash (desync canary)
    expect(stateHash(s)).not.toBe(base);
  });

  it("planeYHold stays TRANSIENT — never written to SaveData, no SAVE bump", () => {
    const s = initGameState(70, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    s.heroes[0].x = 300;
    step(s, { moveTo: { x: 306, y: NEAR } });
    for (let i = 0; i < 400 && s.heroes[0].command; i++) step(s, {});
    expect(s.heroes[0].planeYHold).toBe(NEAR);
    expect(SAVE_VERSION).toBe(20);
    const saved = JSON.stringify(toSaveData(s));
    expect(saved).not.toContain("planeYHold");
    expect(saved).not.toContain("planeY");
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
