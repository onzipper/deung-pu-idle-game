import { describe, it, expect } from "vitest";
import { initGameState, step, migrate, SAVE_VERSION, type Enemy, type GameState } from "@/engine";
import { makeStubEnemy, forceBoss, soloSave } from "./helpers";

/**
 * M6.6 "autoHunt toggle" — the player can turn auto-hunting off/on.
 *
 *  - OFF outside the boss phase: the hero no longer CHASES or INITIATES on
 *    idle/passive mobs, but an already-`engaged` mob (fighting the hero) stays a
 *    valid retaliation target — toggle off mid-swarm finishes off attackers then
 *    idles.
 *  - The boss phase always ignores the toggle.
 *  - Persisted (SAVE v12); a pre-v12 save backfills `true` (unchanged behaviour).
 */

/** A passive (never-initiating) melee mob, not yet engaged. */
function passiveMob(id: number, x: number): Enemy {
  return { ...makeStubEnemy(id, x, 1_000_000), engaged: false, aggressive: false, atk: 10, cd: 0, speed: 44 };
}

/** An already-ENGAGED melee mob (fighting the hero), with real damage output. */
function engagedAttacker(id: number, x: number, hp = 30): Enemy {
  return { ...makeStubEnemy(id, x, hp), engaged: true, aggressive: false, atk: 5, cd: 0, speed: 44 };
}

describe("autoHunt toggle (M6.6)", () => {
  it("OFF in a field of passive mobs: zero new engagements/kills over many steps", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.autoHunt = false;
    const hero = s.heroes[0];
    const startX = hero.x;
    const mob = passiveMob(1, startX + 300);
    s.enemies = [mob];

    let kills = 0;
    for (let i = 0; i < 600; i++) {
      step(s, {});
      for (const e of s.events) if (e.type === "kill") kills++;
    }

    expect(kills).toBe(0);
    expect(mob.engaged).toBe(false); // never hit -> never woke
    expect(hero.x).toBe(startX); // never chased
  });

  it("OFF while an aggressive/engaged mob is attacking: hero finishes it off, then idles", () => {
    const s = initGameState(1);
    s.spawnPaused = true; // no additional spawn-pool mobs to muddy the toggle behaviour
    s.autoHunt = false;
    const hero = s.heroes[0];
    const attacker = engagedAttacker(1, hero.x + 20, 30); // already engaged, in range
    s.enemies = [attacker];

    let killed = false;
    for (let i = 0; i < 600 && !killed; i++) {
      step(s, {});
      for (const e of s.events) if (e.type === "kill") killed = true;
    }
    expect(killed).toBe(true); // retaliation target was valid -> hero fought back

    // Now the field is empty (no engaged targets) -> the hero stands idle: no more
    // movement/kills over a further run.
    const xAfterKill = hero.x;
    for (let i = 0; i < 120; i++) step(s, {});
    expect(hero.x).toBe(xAfterKill);
    expect(s.enemies.length).toBe(0);
  });

  it("boss phase IGNORES the toggle — the boss fight proceeds normally", () => {
    const s = initGameState(1);
    s.autoHunt = false;
    forceBoss(s);
    const hp0 = s.boss!.hp;

    for (let i = 0; i < 300; i++) step(s, {});

    expect(s.boss!.hp).toBeLessThan(hp0); // hero fought the boss despite the toggle
  });

  it("migrate v11 -> v12 backfills autoHunt: true, and a saved flag round-trips", () => {
    const preV12 = migrate({
      version: 11,
      stage: 1,
      gold: 0,
      hero: { cls: "swordsman", level: 1, xp: 0, tier: 1 },
      lastSeen: 0,
    });
    expect(preV12.version).toBe(SAVE_VERSION);
    expect(preV12.autoHunt).toBe(true);

    // idempotent re-migrate of a v12 save with autoHunt:false preserves it.
    const save = soloSave("swordsman", 3);
    save.autoHunt = false;
    const remigrated = migrate(save);
    expect(remigrated.autoHunt).toBe(false);

    // init/save round-trip: initGameState restores it, toSaveData emits it back.
    const state = initGameState(1, remigrated);
    expect(state.autoHunt).toBe(false);
  });

  it("is deterministic: identical toggle flips + inputs produce identical end states", () => {
    const run = (): string => {
      const s = initGameState(9, soloSave("swordsman", 1));
      for (let i = 0; i < 400; i++) {
        s.autoHunt = i % 47 < 23; // flips on/off across the run, same schedule both times
        step(s, {});
      }
      return JSON.stringify({ heroes: s.heroes, enemies: s.enemies });
    };
    expect(run()).toBe(run());
  });
});
