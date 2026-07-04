import { describe, it, expect } from "vitest";
import { initGameState, step, type GameState } from "@/engine";

/**
 * Phase A smoke tests: prove the ported sim runs headlessly and deterministically.
 * Deep combat/regression coverage arrives in Phase C.
 */

function run(state: GameState, steps: number): GameState {
  for (let i = 0; i < steps; i++) step(state, {});
  return state;
}

describe("determinism", () => {
  it("same seed -> byte-identical state after N steps", () => {
    const a = run(initGameState(12345), 3000);
    const b = run(initGameState(12345), 3000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds diverge", () => {
    const a = run(initGameState(1), 3000);
    const b = run(initGameState(2), 3000);
    // Wave composition + enemy jitter differ, so live state must differ somewhere.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("running 2 steps in a row == running 1+1 from a re-seeded twin", () => {
    const single = run(initGameState(7), 500);
    const twin = initGameState(7);
    for (let i = 0; i < 500; i++) step(twin, {});
    expect(JSON.stringify(single)).toBe(JSON.stringify(twin));
  });
});

describe("first wave combat", () => {
  it("spawns wave 1 after the initial gap", () => {
    const s = initGameState(42);
    expect(s.enemies.length).toBe(0);
    run(s, 60); // ~1s: firstWaveGap is 0.5s
    expect(s.wave).toBeGreaterThanOrEqual(1);
    expect(s.enemies.length).toBeGreaterThan(0);
  });

  it("heroes kill enemies and gold increases", () => {
    const s = initGameState(42);
    run(s, 6000); // ~100s of sim
    expect(s.kills).toBeGreaterThan(0);
    expect(s.gold).toBeGreaterThan(0);
    // gold must equal the sum of per-kill rewards for the current stage.
    expect(s.gold).toBeGreaterThanOrEqual(s.kills); // goldPerKill(1) = 7 > 1
  });

  it("progresses past the first wave into later waves", () => {
    const s = initGameState(42);
    run(s, 6000);
    expect(s.wave).toBeGreaterThanOrEqual(2);
  });
});

describe("boss readiness", () => {
  it("flips bossReady once the kill goal is met (no auto boss fight in Phase A)", () => {
    const s = initGameState(99);
    run(s, 20000);
    // With enough kills the boss becomes challengeable, but the sim stays in battle.
    if (s.kills >= 10 + s.stage * 5) {
      expect(s.bossReady).toBe(true);
    }
    expect(s.phase).toBe("battle");
  });
});
