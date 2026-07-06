import { describe, it, expect } from "vitest";
import { CONFIG, initGameState, step, toSaveData, type Enemy, type GameState } from "@/engine";
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
