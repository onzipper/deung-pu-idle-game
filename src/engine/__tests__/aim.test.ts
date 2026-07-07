import { describe, it, expect } from "vitest";
import { initGameState, step, toSaveData, type Enemy, type GameState } from "@/engine";
import { makeStubEnemy, forceBoss, soloSave } from "./helpers";

/**
 * `hero.aimX` — the per-step COMBAT AIM (render-only facing observer). Owner
 * "Option A": a hero FACES its target while fighting, movement direction only
 * while merely walking. `aimX` is the engine's authoritative aim source:
 *  - the world-x of the foe being fought (basic attack / hunt / manual command /
 *    boss), or the target being approached,
 *  - `null` when the hero is idle / merely walking a move order / in town.
 *
 * It is TRANSIENT (reset + re-derived each step, never persisted) and PURE (no
 * RNG), so it can never perturb the sim — asserted here alongside the behaviour.
 */

/** A stationary engaged mob at `x` (never drifts, never hits, huge hp). */
function stubAt(id: number, x: number, hp = 100000): Enemy {
  return { ...makeStubEnemy(id, x, hp), engaged: true, atk: 0, speed: 0, cd: 999 };
}

/** A passive (un-engaged) harmless mob. */
function passive(id: number, x: number, hp = 30): Enemy {
  return { ...makeStubEnemy(id, x, hp), engaged: false, aggressive: false, atk: 0, speed: 0, cd: 999 };
}

function farmState(cls: "swordsman" | "archer" | "mage" = "swordsman"): GameState {
  const s = initGameState(1, soloSave(cls, 1));
  s.spawnPaused = true;
  s.autoHunt = true;
  s.enemies = [];
  return s;
}

describe("hero.aimX (combat-aim facing observer)", () => {
  it("is set to the target's x while attacking a mob in front", () => {
    const s = farmState("swordsman");
    const hero = s.heroes[0];
    const mob = stubAt(1, hero.x + 40);
    s.enemies = [mob];

    step(s, {});
    expect(hero.aimX).not.toBeNull();
    expect(hero.aimX!).toBeGreaterThan(hero.x); // faces the mob (to the right)
    expect(hero.aimX!).toBe(mob.x);
  });

  it("faces a foe BEHIND the hero (aim can point either direction)", () => {
    const s = farmState("swordsman");
    const hero = s.heroes[0];
    const mob = stubAt(1, hero.x - 40); // to the LEFT
    s.enemies = [mob];

    step(s, {});
    expect(hero.aimX).not.toBeNull();
    expect(hero.aimX!).toBeLessThan(hero.x); // faces left, toward the mob
  });

  it("is null while idle (AUTO off, nothing engaged)", () => {
    const s = farmState("swordsman");
    s.autoHunt = false;
    s.enemies = [passive(1, s.heroes[0].x + 60)]; // present but not engageable
    step(s, {});
    expect(s.heroes[0].aimX).toBeNull();
    // ...and stays null across further idle steps (re-derived each step).
    step(s, {});
    expect(s.heroes[0].aimX).toBeNull();
  });

  it("KITING archer: aim points at the target (forward) even while retreating away", () => {
    const s = farmState("archer");
    const hero = s.heroes[0];
    const x0 = hero.x;
    // A mob right on top of the archer forces a kite-retreat (hero.x decreases),
    // but the target is FORWARD (to its right) — aim must track the mob, not the
    // retreat velocity (the "shoots backwards while kiting" bug).
    const mob = stubAt(1, hero.x + 10);
    s.enemies = [mob];

    step(s, {});
    expect(hero.x).toBeLessThan(x0); // retreated LEFT
    expect(hero.aimX).not.toBeNull();
    expect(hero.aimX!).toBeGreaterThan(hero.x); // still faces the mob (RIGHT)
  });

  it("stays non-null across a kill-and-retarget (no null blip while foes remain)", () => {
    const s = farmState("swordsman");
    const hero = s.heroes[0];
    // Two engaged, KILLABLE mobs on the same side.
    s.enemies = [stubAt(1, hero.x + 30, 12), stubAt(2, hero.x + 80, 12)];
    let sawNull = false;
    for (let i = 0; i < 400 && s.enemies.length > 0; i++) {
      step(s, {});
      if (s.enemies.length > 0 && hero.aimX === null) sawNull = true;
    }
    expect(sawNull).toBe(false); // aim never dropped to null while a target existed
  });

  it("goes null once the LAST foe dies (renderer then holds facing)", () => {
    const s = farmState("swordsman");
    const hero = s.heroes[0];
    s.enemies = [stubAt(1, hero.x + 30, 12)];
    for (let i = 0; i < 400 && s.enemies.length > 0; i++) step(s, {});
    expect(s.enemies.length).toBe(0);
    step(s, {}); // an idle step after the field is clear
    expect(hero.aimX).toBeNull();
  });

  it("manual attackTarget: aim tracks the commanded target while STILL APPROACHING", () => {
    const s = farmState("swordsman");
    s.autoHunt = false;
    const hero = s.heroes[0];
    const target = passive(9, hero.x + 400); // far away — not yet in range
    s.enemies = [target];

    step(s, { attackTarget: { id: target.id } });
    expect(hero.command).toEqual({ kind: "attack", targetId: target.id });
    expect(hero.aimX).toBe(target.x); // faces the commanded mob before reaching it
  });

  it("boss fight: aim points at the boss", () => {
    const s = initGameState(1, soloSave("mage", 1));
    forceBoss(s);
    const hero = s.heroes[0];
    step(s, {});
    expect(hero.aimX).not.toBeNull();
    // Boss spawns at the far side; aim points toward it.
    expect(Math.sign(hero.aimX! - hero.x)).toBe(Math.sign(s.boss!.x - hero.x));
  });

  it("is TRANSIENT — never written to SaveData", () => {
    const s = farmState("swordsman");
    s.enemies = [stubAt(1, s.heroes[0].x + 40)];
    step(s, {});
    expect(s.heroes[0].aimX).not.toBeNull();
    const save = toSaveData(s);
    expect(JSON.stringify(save)).not.toContain("aimX");
  });

  it("does not perturb the sim: identical runs stay byte-identical WITH aimX included", () => {
    const runOnce = (): string => {
      const s = initGameState(9, soloSave("archer", 1));
      for (let i = 0; i < 600; i++) step(s, {});
      return JSON.stringify({ heroes: s.heroes, enemies: s.enemies, gold: s.gold, kills: s.kills });
    };
    expect(runOnce()).toBe(runOnce());
  });
});
