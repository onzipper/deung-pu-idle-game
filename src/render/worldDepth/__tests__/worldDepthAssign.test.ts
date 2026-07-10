import { describe, expect, it } from "vitest";
import { hashUnit } from "@/render/worldDepth/depthAssign";

// R4 Wave C0: the per-entity depth ASSIGNMENT (heroDepth/enemyDepth/ghostDepth)
// is retired — depth is engine-owned (`Entity.planeY`, read at the worldFxContext
// seam). `hashUnit` stays as the shared deterministic hash behind terrain-preset /
// weather-window selection + the seam's defensive no-planeY fallback row.
describe("worldDepth stable hash (hashUnit)", () => {
  it("hashUnit is pure, stable, and in [0,1)", () => {
    for (const k of ["a", "hero:1", "42", 42, 0, -7, "ก๊อบ"] as const) {
      const a = hashUnit(k);
      const b = hashUnit(k);
      expect(a).toBe(b); // deterministic across calls
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    // A number and its decimal string hash identically (stringified internally).
    expect(hashUnit(42)).toBe(hashUnit("42"));
    // Distinct keys give distinct values (no trivial collisions here).
    expect(hashUnit("a")).not.toBe(hashUnit("b"));
    expect(hashUnit(1)).not.toBe(hashUnit(2));
  });

  it("hashUnit spreads roughly uniformly (deterministic sweep)", () => {
    let sum = 0;
    const N = 5000;
    const deciles = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const u = hashUnit(`enemy:${i}`);
      sum += u;
      deciles[Math.min(9, Math.floor(u * 10))]++;
    }
    const mean = sum / N;
    expect(mean).toBeGreaterThan(0.46);
    expect(mean).toBeLessThan(0.56);
    for (const d of deciles) {
      expect(d / N).toBeGreaterThan(0.05); // ~10% each, generous margins
      expect(d / N).toBeLessThan(0.15);
    }
  });
});
