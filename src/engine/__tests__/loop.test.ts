import { describe, it, expect } from "vitest";
import { createAccumulator, drainAccumulator, FIXED_DT } from "@/engine/core/loop";
import { createRng } from "@/engine/core/rng";
import { migrate, SAVE_VERSION } from "@/engine/state/version";

/**
 * Baseline headless tests. They exist mainly to prove the engine runs under
 * Vitest with zero browser/DOM — the property the whole architecture depends on.
 * Real combat/balance tests arrive with the engine port (M1).
 */

describe("fixed-timestep accumulator", () => {
  it("runs one step per FIXED_DT at 1x speed", () => {
    const acc = createAccumulator();
    expect(drainAccumulator(acc, FIXED_DT, 1)).toBe(1);
  });

  it("runs more sub-steps at higher speed without changing dt", () => {
    const acc = createAccumulator();
    // One real frame of FIXED_DT at 3x = 3 fixed sub-steps.
    expect(drainAccumulator(acc, FIXED_DT, 3)).toBe(3);
  });

  it("carries the remainder across frames", () => {
    const acc = createAccumulator();
    drainAccumulator(acc, FIXED_DT * 0.5, 1); // not enough for a step
    expect(drainAccumulator(acc, FIXED_DT * 0.5, 1)).toBe(1); // now it fires
  });
});

describe("seeded rng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(a.next()).toBe(b.next());
  });
});

describe("save migration", () => {
  it("fills defaults and stamps the current version", () => {
    const save = migrate({});
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.hero.cls).toBe("swordsman");
  });
});
