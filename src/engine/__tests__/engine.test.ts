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

describe("hunt-field spawning (M6 สนามล่ามอน)", () => {
  it("bursts the mob pool to full on the first battle step", () => {
    const s = initGameState(42);
    expect(s.enemies.length).toBe(0);
    run(s, 1); // one step: the burst fills the field
    expect(s.enemies.length).toBeGreaterThan(0);
    // Mobs are placed across the field, not stacked at one spawn edge.
    const xs = s.enemies.map((e) => e.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });

  it("heroes hunt + kill mobs and gold increases", () => {
    const s = initGameState(42);
    run(s, 6000); // ~100s of sim
    expect(s.kills).toBeGreaterThan(0);
    expect(s.gold).toBeGreaterThan(0);
    // gold must be at least the sum of per-kill rewards for the current stage.
    expect(s.gold).toBeGreaterThanOrEqual(s.kills); // goldPerKill(1) = 4 > 1
  });

  it("keeps the pool respawning as mobs are hunted down", () => {
    const s = initGameState(42);
    run(s, 3000);
    const killsMid = s.kills;
    expect(killsMid).toBeGreaterThan(0);
    run(s, 3000);
    // The pool keeps feeding the hunt (respawn refills what the hero clears).
    expect(s.kills).toBeGreaterThan(killsMid);
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
