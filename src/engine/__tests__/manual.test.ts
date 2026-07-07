import { describe, it, expect } from "vitest";
import {
  CONFIG,
  initGameState,
  npcInRange,
  step,
  toSaveData,
  townNpcConfig,
  type Enemy,
  type GameState,
} from "@/engine";
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
