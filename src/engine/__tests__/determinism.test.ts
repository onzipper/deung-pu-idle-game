import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  createAccumulator,
  drainAccumulator,
  FIXED_DT,
  migrate,
  SAVE_VERSION,
} from "@/engine";
import type { FrameInput, GameState, SaveData } from "@/engine";
import { soloSave } from "./helpers";

/**
 * Determinism-under-input coverage (Phase C handoff, the most important
 * guarantee this project has): record/replay of a mixed-input script, the
 * fixed-timestep speed-multiplier contract (more sub-steps, never a bigger
 * dt), and save round-trip / migrate() shape-filling.
 *
 * engine.test.ts already proves plain idle-stepping is deterministic; this
 * file adds player *input* (casts, evolve, challenge/advance, toggles) into the
 * mix, which is where a hidden `Math.random()` or wall-clock read would most
 * plausibly sneak in. (M5: the buyUpgrade intent is gone.)
 */

function scriptedInput(i: number): FrameInput {
  const input: FrameInput = {};
  if (i % 47 === 3) input.castSkills = [0];
  if (i % 599 === 23) input.challengeBoss = true;
  if (i % 599 === 400) input.advanceStage = true;
  if (i % 733 === 29) input.evolveHero = 0;
  return input;
}

function runScript(seed: number, steps: number): GameState {
  const s = initGameState(seed, soloSave("swordsman", 1));
  s.gold = 100_000; // afford evolution so it deterministically fires
  for (let i = 0; i < steps; i++) {
    if (i === 500) s.autoCast = true;
    step(s, scriptedInput(i));
  }
  return s;
}

describe("record/replay determinism", () => {
  it("the same seed + scripted mixed-input sequence replays byte-identical", () => {
    const a = runScript(12321, 5000);
    const b = runScript(12321, 5000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed with the identical script diverges somewhere", () => {
    const a = runScript(12321, 3000);
    const b = runScript(9, 3000);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("speed semantics: more sub-steps, never a bigger dt", () => {
  function driveFrames(seed: number, speed: number, frames: number): GameState {
    const s = initGameState(seed);
    const acc = createAccumulator();
    for (let f = 0; f < frames; f++) {
      const n = drainAccumulator(acc, FIXED_DT, speed);
      for (let i = 0; i < n; i++) step(s, {});
    }
    return s;
  }

  it("3x speed for N frames == 1x speed for 3N frames (identical total fixed steps)", () => {
    const fast = driveFrames(99, 3, 400); // 400 frames * 3x = 1200 fixed steps
    const slow = driveFrames(99, 1, 1200); // 1200 frames * 1x = 1200 fixed steps
    expect(JSON.stringify(fast)).toBe(JSON.stringify(slow));
  });

  it("2x speed for N frames == 1x speed for 2N frames (identical total fixed steps)", () => {
    const fast = driveFrames(7, 2, 777);
    const slow = driveFrames(7, 1, 1554);
    expect(JSON.stringify(fast)).toBe(JSON.stringify(slow));
  });

  it("drainAccumulator yields exactly speed*frames steps with no rounding loss", () => {
    const acc = createAccumulator();
    let total = 0;
    for (let f = 0; f < 500; f++) total += drainAccumulator(acc, FIXED_DT, 2);
    expect(total).toBe(1000);
  });
});

describe("save round-trip", () => {
  it("restores stage/gold/character from a v4 save produced mid-run", () => {
    const s = initGameState(1, soloSave("mage", 2));
    s.gold = 4321;
    s.heroes[0].level = 8;

    const save: SaveData = {
      version: SAVE_VERSION,
      stage: s.stage,
      gold: s.gold,
      hero: { cls: "mage", level: 8, xp: 12, tier: 1 },
      lastSeen: 123456,
    };

    const restored = initGameState(999, save);

    expect(restored.stage).toBe(s.stage);
    expect(restored.gold).toBe(s.gold);
    expect(restored.heroClass).toBe("mage");
    expect(restored.heroes).toHaveLength(1);
    expect(restored.heroes[0].cls).toBe("mage");
    expect(restored.heroes[0].level).toBe(8);
    // A restored save always starts fresh at wave 0 of the saved stage.
    expect(restored.wave).toBe(0);
    expect(restored.phase).toBe("battle");
  });

  it("migrate() fills every default field for a bare/old save shape", () => {
    const migrated = migrate({});
    expect(migrated).toEqual({
      version: SAVE_VERSION,
      stage: 1,
      gold: 0,
      hero: { cls: "swordsman", level: 1, xp: 0, tier: 1 },
      lastSeen: 0,
    });
  });

  it("migrate() only fills missing fields, preserving present ones", () => {
    const partial = migrate({ stage: 7, gold: 500 });
    expect(partial.stage).toBe(7);
    expect(partial.gold).toBe(500);
    expect(partial.hero.cls).toBe("swordsman");
    expect(partial.version).toBe(SAVE_VERSION);
  });

  it("migrate() adopts the highest-level hero from a pre-v4 team save (lossy)", () => {
    const v3 = {
      version: 3,
      stage: 6,
      gold: 999,
      unlocked: ["swordsman", "archer", "mage"],
      upgrades: { atk: 5, speed: 3, hp: 4 },
      heroes: [
        { level: 4, xp: 1, tier: 1 },
        { level: 11, xp: 7, tier: 2 },
        { level: 9, xp: 2, tier: 1 },
      ],
      lastSeen: 42,
    };
    const migrated = migrate(v3);
    // Highest level (archer @ 11) becomes the single character; upgrades dropped.
    expect(migrated.hero).toEqual({ cls: "archer", level: 11, xp: 7, tier: 2 });
    expect(migrated.stage).toBe(6);
    expect(migrated.gold).toBe(999);
    expect("upgrades" in migrated).toBe(false);
    expect("unlocked" in migrated).toBe(false);
  });

  it("migrate() is idempotent", () => {
    const once = migrate({ stage: 3, gold: 10, hero: { cls: "archer", level: 5, xp: 2, tier: 1 } });
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });
});
