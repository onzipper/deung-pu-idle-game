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
import { threeHeroSave } from "./helpers";

/**
 * Determinism-under-input coverage (Phase C handoff, the most important
 * guarantee this project has): record/replay of a mixed-input script, the
 * fixed-timestep speed-multiplier contract (more sub-steps, never a bigger
 * dt), and save round-trip / migrate() shape-filling.
 *
 * engine.test.ts already proves plain idle-stepping is deterministic; this
 * file adds player *input* (casts, buys, challenge/advance, toggles) into the
 * mix, which is where a hidden `Math.random()` or wall-clock read would most
 * plausibly sneak in.
 */

function scriptedInput(i: number): FrameInput {
  const input: FrameInput = {};
  if (i % 47 === 3) input.castSkills = [0];
  if (i % 91 === 5) input.castSkills = [...(input.castSkills ?? []), 1, 2];
  if (i % 131 === 7) input.buyUpgrade = "atk";
  else if (i % 197 === 11) input.buyUpgrade = "hp";
  else if (i % 251 === 17) input.buyUpgrade = "speed";
  if (i % 599 === 23) input.challengeBoss = true;
  if (i % 599 === 400) input.advanceStage = true;
  return input;
}

function runScript(seed: number, steps: number): GameState {
  const s = initGameState(seed, threeHeroSave(1));
  s.gold = 100_000; // afford upgrades so buys deterministically actually happen
  for (let i = 0; i < steps; i++) {
    if (i === 500) s.autoCast = true;
    if (i === 1500) s.autoUpgrade = true;
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
  it("restores stage/gold/upgrades/slots from a save produced mid-run", () => {
    const s = initGameState(1, threeHeroSave(2));
    s.gold = 4321;
    s.upgrades = { atk: 3, speed: 2, hp: 1 };

    const save: SaveData = {
      version: SAVE_VERSION,
      stage: s.stage,
      gold: s.gold,
      unlocked: ["swordsman", "archer", "mage"],
      upgrades: { ...s.upgrades },
      heroes: [],
      lastSeen: 123456,
    };

    const restored = initGameState(999, save);

    expect(restored.stage).toBe(s.stage);
    expect(restored.gold).toBe(s.gold);
    expect(restored.upgrades).toEqual(s.upgrades);
    expect(restored.heroSlots).toBe(3);
    expect(restored.heroes.map((h) => h.cls)).toEqual([
      "swordsman",
      "archer",
      "mage",
    ]);
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
      unlocked: ["swordsman"],
      upgrades: { atk: 0, speed: 0, hp: 0 },
      // v1->v2: one unlocked hero defaults to level 1 / xp 0.
      heroes: [{ level: 1, xp: 0 }],
      lastSeen: 0,
    });
  });

  it("migrate() only fills missing fields, preserving present ones", () => {
    const partial = migrate({ stage: 7, gold: 500 });
    expect(partial.stage).toBe(7);
    expect(partial.gold).toBe(500);
    expect(partial.unlocked).toEqual(["swordsman"]);
    expect(partial.upgrades).toEqual({ atk: 0, speed: 0, hp: 0 });
    expect(partial.version).toBe(SAVE_VERSION);
  });

  it("migrate() is idempotent", () => {
    const once = migrate({ stage: 3, gold: 10, unlocked: ["swordsman", "archer"] });
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });
});
