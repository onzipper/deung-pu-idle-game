import { describe, it, expect } from "vitest";
import {
  CONFIG,
  initGameState,
  makeHero,
  npcInRange,
  step,
  toSaveData,
  townNpcConfig,
  type Enemy,
  type GameState,
} from "@/engine";
import { FIXED_DT } from "@/engine/core/loop";
import { makeStubEnemy, forceBoss, soloSave } from "./helpers";

/**
 * M7.8 "Manual Play" — RO-style tap-to-move / tap-to-attack. The player's intents
 * (moveTo / attackTarget / cancelCommand) set the solo hero's transient command,
 * honoured by the hunt movement and OVERRIDDEN by the boss phase's forced combat.
 * Deterministic, no RNG, no SAVE bump (command state is transient).
 */

/** A passive, stationary, harmless mob (never initiates, never drifts, never hits). */
function passiveMob(id: number, x: number, hp = 30): Enemy {
  return { ...makeStubEnemy(id, x, hp), engaged: false, aggressive: false, atk: 0, speed: 0, cd: 999 };
}

/** Step a state N times with a constant (default empty) input. */
function run(s: GameState, n: number, input = {}): void {
  for (let i = 0; i < n; i++) step(s, input);
}

describe("manual play (M7.8)", () => {
  it("moveTo: hero walks to the commanded x, then the command completes", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    const hero = s.heroes[0];
    const goal = 600;

    step(s, { moveTo: { x: goal } });
    expect(hero.command).toEqual({ kind: "move", x: goal });

    run(s, 400);
    expect(Math.abs(hero.x - goal)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
    expect(hero.command).toBeNull(); // arrival completed the command
  });

  it("moveTo clamps to the walkable bounds and emits moveOrdered with the clamped x", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 99999 } });
    const ev = s.events.find((e) => e.type === "moveOrdered");
    expect(ev).toBeDefined();
    const maxX = 900 - CONFIG.hunt.fieldRightMargin; // map1 fieldWidth 900
    expect(ev && ev.type === "moveOrdered" && ev.x).toBe(maxX);
    expect(s.heroes[0].command).toEqual({ kind: "move", x: maxX });
  });

  it("moveTo ignores huntable targets even with AUTO on (walks past a passive mob)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.autoHunt = true; // auto would otherwise hunt the mob
    const mob = passiveMob(1, 250);
    s.enemies = [mob];

    step(s, { moveTo: { x: 600 } });
    // Run until the move command completes (arrival). The mob must be untouched at
    // that moment — the hero never attacked while walking through its position.
    let arrived = false;
    for (let i = 0; i < 400 && !arrived; i++) {
      step(s, {});
      arrived = s.heroes[0].command === null;
    }
    expect(arrived).toBe(true);
    expect(mob.hp).toBe(mob.maxHp); // never attacked it while moving through
    // Reached the goal region (well past the mob at x=250). On the arrival step AUTO
    // resumes and heads back toward the mob, so x sits within ~one hunt-step of 600.
    expect(s.heroes[0].x).toBeGreaterThan(560);
  });

  it("moveTo does NOT drop aggro: an engaged mob keeps attacking the hero", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const hero = s.heroes[0];
    const attacker: Enemy = { ...makeStubEnemy(1, hero.x + 20, 1_000_000), engaged: true, atk: 5, cd: 0, speed: 44 };
    s.enemies = [attacker];
    const hp0 = hero.hp;

    step(s, { moveTo: { x: CONFIG.hunt.heroMinX } }); // try to walk away
    run(s, 120);

    expect(attacker.engaged).toBe(true); // still engaged (aggro not dropped)
    expect(hero.hp).toBeLessThan(hp0); // still being hit
  });

  it("attackTarget overrides auto-hunt (AUTO on): kills the COMMANDED far mob first, then resumes", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.autoHunt = true;
    const near = passiveMob(1, 300, 30);
    const far = passiveMob(2, 600, 30);
    s.enemies = [near, far];

    step(s, { attackTarget: { id: far.id } });
    expect(s.heroes[0].command).toEqual({ kind: "attack", targetId: far.id });

    // Run until the commanded FAR mob dies; the near mob must still be alive then
    // (proving the command overrode nearest-target auto-hunt).
    let farGone = false;
    for (let i = 0; i < 800 && !farGone; i++) {
      step(s, {});
      farGone = !s.enemies.some((e) => e.id === far.id);
    }
    expect(farGone).toBe(true);
    expect(s.enemies.some((e) => e.id === near.id)).toBe(true); // near mob spared

    // The command self-clears the step after the target leaves the enemy list
    // (resolveDeaths runs after updateHeroes), then AUTO-on hunt clears the near mob.
    step(s, {});
    expect(s.heroes[0].command).toBeNull();
    run(s, 800);
    expect(s.enemies.length).toBe(0);
  });

  it("attackTarget engages a passive mob with AUTO OFF, then idles after the kill", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.autoHunt = false;
    const target = passiveMob(1, 500, 30);
    const bystander = passiveMob(2, 300, 30);
    s.enemies = [target, bystander];

    step(s, { attackTarget: { id: target.id } });
    let killed = false;
    for (let i = 0; i < 800 && !killed; i++) {
      step(s, {});
      killed = !s.enemies.some((e) => e.id === target.id);
    }
    expect(killed).toBe(true); // engaged a passive mob under command despite AUTO off

    // AUTO off + no command -> idle: the bystander is never touched.
    const xIdle = s.heroes[0].x;
    run(s, 300);
    expect(s.enemies.some((e) => e.id === bystander.id)).toBe(true);
    expect(bystander.hp).toBe(bystander.maxHp);
    expect(s.heroes[0].x).toBe(xIdle);
    expect(s.heroes[0].command).toBeNull();
  });

  it("attackTarget with an invalid / dead id is ignored gracefully (clears nothing)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const mob = passiveMob(1, 400, 30);
    s.enemies = [mob];

    // Set a valid move command, then fire a bogus attackTarget: it must NOT crash
    // and must NOT clear the existing command.
    step(s, { moveTo: { x: 500 } });
    const before = s.heroes[0].command;
    step(s, { attackTarget: { id: 987654 } });
    expect(s.heroes[0].command).toEqual(before); // unchanged
    expect(s.events.some((e) => e.type === "targetLocked")).toBe(false);
  });

  it("a newer command replaces the older one", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const mob = passiveMob(1, 400, 30);
    s.enemies = [mob];

    step(s, { attackTarget: { id: mob.id } });
    expect(s.heroes[0].command?.kind).toBe("attack");
    step(s, { moveTo: { x: 200 } });
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 200 });
  });

  it("cancelCommand clears an active command (and emits once), no-ops when none", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];

    step(s, { moveTo: { x: 500 } });
    step(s, { cancelCommand: true });
    expect(s.heroes[0].command).toBeNull();
    expect(s.events.some((e) => e.type === "commandCancelled")).toBe(true);

    // No command -> cancel is a silent no-op.
    step(s, { cancelCommand: true });
    expect(s.events.some((e) => e.type === "commandCancelled")).toBe(false);
  });

  it("boss phase forced-combat OVERRIDES a manual command", () => {
    const s = initGameState(1);
    forceBoss(s);
    const hp0 = s.boss!.hp;

    // Command the hero to walk to the far LEFT edge; the boss fight must ignore it.
    step(s, { moveTo: { x: CONFIG.hunt.heroMinX } });
    run(s, 300);

    expect(s.boss!.hp).toBeLessThan(hp0); // fought the boss regardless of the command
  });

  it("targetLocked / moveOrdered events carry the locked id / clamped x", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const mob = passiveMob(7, 420, 30);
    s.enemies = [mob];

    step(s, { attackTarget: { id: mob.id } });
    const locked = s.events.find((e) => e.type === "targetLocked");
    expect(locked && locked.type === "targetLocked" && locked.id).toBe(mob.id);
  });

  it("command state is transient — never written to SaveData", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [passiveMob(1, 400, 30)];
    step(s, { attackTarget: { id: 1 } });
    expect(s.heroes[0].command).not.toBeNull();
    const save = toSaveData(s);
    expect(JSON.stringify(save)).not.toContain("command");
  });

  it("is deterministic: an identical command schedule reproduces the same state", () => {
    const runOnce = (): string => {
      const s = initGameState(9, soloSave("swordsman", 1));
      for (let i = 0; i < 500; i++) {
        const input =
          i === 10 ? { moveTo: { x: 500 } } :
          i === 120 ? { attackTarget: { id: s.enemies[0]?.id ?? -1 } } :
          i === 300 ? { cancelCommand: true } :
          {};
        step(s, input);
      }
      return JSON.stringify({ heroes: s.heroes, enemies: s.enemies });
    };
    expect(runOnce()).toBe(runOnce());
  });
});

/**
 * R4 Wave C2 → FREE-FIELD Phase 1 — moveTo gains an OPTIONAL depth-row `y`. An x-only move is
 * byte-identical to pre-C2 (command shape + event, home-row steering, x-only arrival); an x/y
 * move clamps y to the play FIELD at intake and now walks an HONEST straight line to (x, y) at
 * the walk speed (diagonal not faster than axis-aligned; both axes arrive together, snapping onto
 * the exact point). y is cosmetic (never gates combat). Non-finite y → treated as absent (x-only).
 */
describe("manual play — moveTo x/y (free-field 2D)", () => {
  const NEAR = CONFIG.plane.bandNear; // 56
  const FAR = CONFIG.plane.bandFar; // -64
  const YEPS = CONFIG.plane.yArriveEps;

  it("x-only moveTo is byte-identical: command + event carry NO y (home-row steer)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 500 } });
    const cmd = s.heroes[0].command!;
    expect(cmd).toEqual({ kind: "move", x: 500 });
    expect("y" in cmd).toBe(false); // no undefined-y key leaked onto the command
    const ev = s.events.find((e) => e.type === "moveOrdered")!;
    expect(ev.type === "moveOrdered" && "y" in ev).toBe(false); // event stays pre-C2 shaped
  });

  it("x/y moveTo clamps y into the plane band at intake (both edges) + carries it on the event", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];

    step(s, { moveTo: { x: 400, y: NEAR + 999 } }); // far past the near edge
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 400, y: NEAR });
    const evHi = s.events.find((e) => e.type === "moveOrdered")!;
    expect(evHi.type === "moveOrdered" && evHi.y).toBe(NEAR);

    step(s, { moveTo: { x: 400, y: FAR - 999 } }); // far past the far edge
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 400, y: FAR });
  });

  it("a non-finite y is treated as ABSENT (x-only command, no y key)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 350, y: Number.NaN } });
    const cmd = s.heroes[0].command!;
    expect(cmd).toEqual({ kind: "move", x: 350 });
    expect("y" in cmd).toBe(false);
    step(s, { moveTo: { x: 350, y: Infinity } });
    expect("y" in s.heroes[0].command!).toBe(false);
  });

  it("hunt-phase x/y move walks a straight line to (x,y); both axes arrive together, snapping onto the point", () => {
    const s = initGameState(2, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 100;
    h.planeY = FAR; // start a full field away from the near-row target
    const goalX = 600;

    step(s, { moveTo: { x: goalX, y: NEAR } });
    expect(h.command).toEqual({ kind: "move", x: goalX, y: NEAR });

    // planeY climbs monotonically toward NEAR while walking (no independent y ease that would
    // race x); the command clears only when the straight-line distance is within arriveEps.
    let cleared = -1;
    let prevY = FAR - 1e-9;
    for (let i = 0; i < 600; i++) {
      step(s, {});
      if (h.command) {
        expect(h.planeY!).toBeGreaterThanOrEqual(prevY); // monotone toward the near row
        expect(h.planeY!).toBeLessThanOrEqual(NEAR + 1e-9); // never overshoots
        prevY = h.planeY!;
      } else {
        cleared = i;
        break;
      }
    }
    expect(cleared).toBeGreaterThan(0);
    // On completion the hero SNAPS onto the exact tapped point — both axes arrived together.
    expect(h.x).toBe(goalX);
    expect(h.planeY).toBe(NEAR);
  });

  it("a pure-y move (x already at target) keeps x fixed and eases planeY to the row, then completes", () => {
    const s = initGameState(3, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 300;
    h.planeY = FAR;
    // Command x == current x (a pure depth move): x must never move; planeY eases along the line.
    step(s, { moveTo: { x: 300, y: NEAR } });
    expect(h.command).not.toBeNull();

    let prevY = FAR - 1e-9;
    for (let i = 0; i < 300 && h.command; i++) {
      step(s, {});
      expect(h.x).toBe(300); // pure-y: x is untouched every step
      if (h.command) {
        expect(h.planeY!).toBeGreaterThanOrEqual(prevY); // monotone toward NEAR
        prevY = h.planeY!;
      }
    }
    expect(h.command).toBeNull(); // cleared once the row was reached
    expect(h.planeY).toBe(NEAR); // snapped onto the exact row
    expect(h.x).toBe(300); // never walked (x was already there)
  });

  it("a diagonal move is NOT faster than an axis-aligned one (normalized 2D speed)", () => {
    // The per-step displacement magnitude never exceeds one frame's walk budget. The OLD dishonest
    // model moved x at huntSpeed AND y at ySpeed at once → up to sqrt(175²+120²) ≈ 212 > 175.
    const s = initGameState(5, soloSave("swordsman", 3));
    s.spawnPaused = true;
    s.enemies = [];
    const h = s.heroes[0];
    h.x = 100;
    h.planeY = FAR;
    const budget = CONFIG.hunt.huntSpeed * FIXED_DT;
    step(s, { moveTo: { x: 800, y: NEAR } });
    let px = h.x;
    let py = h.planeY!;
    for (let i = 0; i < 60 && h.command; i++) {
      step(s, {});
      const disp = Math.hypot(h.x - px, h.planeY! - py);
      expect(disp).toBeLessThanOrEqual(budget + 1e-9);
      px = h.x;
      py = h.planeY!;
    }
  });

  it("is deterministic across two runs with an x/y command active", () => {
    const runOnce = (): string => {
      const s = initGameState(9, soloSave("swordsman", 3));
      s.spawnPaused = true;
      s.enemies = [];
      s.heroes[0].planeY = FAR;
      for (let i = 0; i < 120; i++) step(s, i === 5 ? { moveTo: { x: 550, y: NEAR } } : {});
      return JSON.stringify({ x: s.heroes[0].x, planeY: s.heroes[0].planeY, cmd: s.heroes[0].command });
    };
    expect(runOnce()).toBe(runOnce());
  });

  it("town x/y walk: the hero arrives on BOTH x and the depth row, then completes", () => {
    const s = initGameState(1);
    s.location = { mapId: "map1", zoneIdx: 0 }; // town
    const h = s.heroes[0];
    h.x = 100;
    h.planeY = FAR;
    const goal = 400;

    step(s, { moveTo: { x: goal, y: NEAR } });
    expect(h.command).toEqual({ kind: "move", x: goal, y: NEAR });
    for (let i = 0; i < 400 && h.command; i++) step(s, {});
    expect(h.command).toBeNull();
    expect(Math.abs(h.x - goal)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
    expect(Math.abs(h.planeY! - NEAR)).toBeLessThanOrEqual(YEPS);
  });

  it("x/y command stays TRANSIENT — never written to SaveData, no SAVE bump", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 500, y: NEAR } });
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 500, y: NEAR });
    expect(JSON.stringify(toSaveData(s))).not.toContain("command");
  });
});

/**
 * UAT round-3 REGRESSION: the town early-return in step() skipped applyManualCommand
 * AND updateHeroes, so a moveTo in town was silently dropped — tap-the-ground did
 * nothing, and the phase-3 tap-an-NPC-to-approach never walked, so the talk range
 * was never reached (NPC panels unreachable). These run through step() IN TOWN —
 * the path the original manual-play tests never exercised.
 */
describe("manual play in town (UAT round-3 regression)", () => {
  const TOWN = { mapId: "map1", zoneIdx: 0 };

  /** A state parked in town with the hero at the entry side. */
  function townState(): GameState {
    const s = initGameState(1);
    s.location = { ...TOWN };
    s.heroes[0].x = 100;
    return s;
  }

  it("moveTo in town walks the hero to the commanded x and completes", () => {
    const s = townState();
    const hero = s.heroes[0];
    const goal = 400;

    step(s, { moveTo: { x: goal } });
    expect(hero.command).toEqual({ kind: "move", x: goal });
    const ev = s.events.find((e) => e.type === "moveOrdered");
    expect(ev && ev.type === "moveOrdered" && ev.x).toBe(goal); // tap ping fires in town too

    for (let i = 0; i < 400 && hero.command; i++) step(s, {});
    expect(hero.command).toBeNull(); // arrival completed the command
    expect(Math.abs(hero.x - goal)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
  });

  it("tap-an-NPC-to-approach: walking to ลุงดึ๋ง's anchor reaches talk range", () => {
    const s = townState();
    const smith = townNpcConfig("npc:lungdueng");
    expect(npcInRange(s, "npc:lungdueng")).toBe(false); // entry side, out of range

    // The GameClient out-of-range tap queues exactly this: moveTo the anchor x.
    step(s, { moveTo: { x: smith.x } });
    for (let i = 0; i < 400 && s.heroes[0].command; i++) step(s, {});
    expect(npcInRange(s, "npc:lungdueng")).toBe(true); // tap-again-to-talk now gates open
  });

  it("cancelCommand works in town (walk stops where it is)", () => {
    const s = townState();
    step(s, { moveTo: { x: 500 } });
    for (let i = 0; i < 30; i++) step(s, {});
    const midX = s.heroes[0].x;
    expect(midX).toBeGreaterThan(100); // genuinely underway
    step(s, { cancelCommand: true });
    expect(s.heroes[0].command).toBeNull();
    expect(s.events.some((e) => e.type === "commandCancelled")).toBe(true);
    for (let i = 0; i < 30; i++) step(s, {});
    expect(s.heroes[0].x).toBe(midX); // stays put
  });

  it("the bot's town walk keeps priority — a manual move waits it out", () => {
    const s = townState();
    const merchant = townNpcConfig("npc:pahpu");
    s.heroes[0].x = merchant.x + 200; // right of ป้าปุ๊, walk goes LEFT
    s.botWalk = { restock: true, sell: false };

    // Command a move further RIGHT while the bot walk owns the hero's feet.
    step(s, { moveTo: { x: merchant.x + 400 } });
    expect(s.heroes[0].command).toEqual({ kind: "move", x: merchant.x + 400 });
    expect(s.heroes[0].x).toBeLessThan(merchant.x + 200); // botWalk moved him LEFT

    // The command survives the walk (resumes once botWalk completes) — it is
    // never fought over per-step ("a manual command can't wedge the trip").
    for (let i = 0; i < 10 && s.botWalk; i++) step(s, {});
    expect(s.heroes[0].command).toEqual({ kind: "move", x: merchant.x + 400 });
  });

  it("a fast-travel channel in town stands still — no manual walk mid-channel", () => {
    const s = townState();
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 1 } });
    expect(s.fastTravelCast).not.toBeNull();
    const x0 = s.heroes[0].x;
    step(s, { moveTo: { x: 500 } });
    for (let i = 0; i < 20 && s.fastTravelCast; i++) step(s, {});
    // Never moved while the channel ran (it either completed the warp or is
    // still standing) — the town walk honours the channeling gate.
    if (s.fastTravelCast) expect(s.heroes[0].x).toBe(x0);
    else expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 });
  });
});

/**
 * M8 party cohort REGRESSION: in town, tickTownManualWalk hardcoded heroes[0], so
 * only the first cohort member ever walked to a tap. Every hero must honour its
 * OWN per-lane MOVE command (each member's tap lands on heroes[myCohortIndex] via
 * applyManualCommand). Driven through step() IN TOWN via a PartyInput lane array.
 */
describe("manual play in town — party cohort (M8)", () => {
  const TOWN = { mapId: "map1", zoneIdx: 0 };

  /** A two-hero (sword + archer) party parked in town at the entry side. */
  function townParty(): GameState {
    const s = initGameState(1);
    s.location = { ...TOWN };
    s.heroes = [makeHero(1, "swordsman"), makeHero(2, "archer")];
    s.nextId = 3;
    s.heroes[0].x = 100;
    s.heroes[1].x = 100;
    return s;
  }

  it("hero[1]'s move command walks hero[1] while hero[0] (no command) stands still", () => {
    const s = townParty();
    const [h0, h1] = s.heroes;
    const goal = 400;

    step(s, [{}, { moveTo: { x: goal } }]); // lane 1 drives heroes[1]
    expect(h0.command).toBeNull();
    expect(h1.command).toEqual({ kind: "move", x: goal });

    for (let i = 0; i < 400 && h1.command; i++) step(s, {});
    expect(h1.command).toBeNull(); // arrived
    expect(Math.abs(h1.x - goal)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
    expect(h0.x).toBe(100); // never moved — no command of its own
  });

  it("both heroes walk independently to their own commanded x", () => {
    const s = townParty();
    const [h0, h1] = s.heroes;

    step(s, [{ moveTo: { x: 300 } }, { moveTo: { x: 550 } }]);
    expect(h0.command).toEqual({ kind: "move", x: 300 });
    expect(h1.command).toEqual({ kind: "move", x: 550 });

    for (let i = 0; i < 400 && (h0.command || h1.command); i++) step(s, {});
    expect(h0.command).toBeNull();
    expect(h1.command).toBeNull();
    expect(Math.abs(h0.x - 300)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
    expect(Math.abs(h1.x - 550)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
  });

  it("solo (one hero) town walk is unchanged", () => {
    const s = initGameState(1);
    s.location = { ...TOWN };
    const hero = s.heroes[0];
    hero.x = 100;
    const goal = 400;

    step(s, { moveTo: { x: goal } });
    expect(hero.command).toEqual({ kind: "move", x: goal });
    for (let i = 0; i < 400 && hero.command; i++) step(s, {});
    expect(hero.command).toBeNull();
    expect(Math.abs(hero.x - goal)).toBeLessThanOrEqual(CONFIG.manual.arriveEps);
  });
});
