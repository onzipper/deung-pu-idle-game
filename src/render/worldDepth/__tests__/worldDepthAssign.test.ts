import { describe, expect, it } from "vitest";
import {
  hashUnit,
  heroDepth,
  enemyDepth,
  ghostDepth,
  HERO_SOLO_DEPTH,
  HERO_BAND_MIN,
  HERO_BAND_MAX,
} from "@/render/worldDepth/depthAssign";

describe("worldDepth depth assignment", () => {
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

  it("solo hero sits at HERO_SOLO_DEPTH regardless of slot", () => {
    expect(HERO_SOLO_DEPTH).toBe(0.65);
    for (const slot of [0, 1, 5]) expect(heroDepth(slot, 1)).toBe(HERO_SOLO_DEPTH);
    expect(heroDepth(0, 0)).toBe(HERO_SOLO_DEPTH); // partySize 0/1 both = solo
  });

  it("party heroes spread evenly across [MIN,MAX] in slot order", () => {
    expect(HERO_BAND_MIN).toBe(0.45);
    expect(HERO_BAND_MAX).toBe(0.85);
    for (const N of [2, 3, 6]) {
      const ds = Array.from({ length: N }, (_, s) => heroDepth(s, N));
      expect(ds[0]).toBeCloseTo(HERO_BAND_MIN, 12); // slot 0 = far edge
      expect(ds[N - 1]).toBeCloseTo(HERO_BAND_MAX, 12); // last slot = near edge
      const gap = (HERO_BAND_MAX - HERO_BAND_MIN) / (N - 1);
      for (let i = 1; i < N; i++) {
        expect(ds[i]).toBeGreaterThan(ds[i - 1]); // strictly increasing
        expect(ds[i] - ds[i - 1]).toBeCloseTo(gap, 12); // even spacing
      }
      for (const d of ds) {
        expect(d).toBeGreaterThanOrEqual(HERO_BAND_MIN - 1e-9);
        expect(d).toBeLessThanOrEqual(HERO_BAND_MAX + 1e-9);
      }
    }
  });

  it("a stray slot clamps into the band (never leaves [MIN,MAX])", () => {
    expect(heroDepth(-3, 4)).toBe(HERO_BAND_MIN); // clamped to slot 0
    expect(heroDepth(99, 4)).toBe(HERO_BAND_MAX); // clamped to last slot
  });

  it("enemyDepth / ghostDepth are stable hashes over the full [0,1) band", () => {
    expect(enemyDepth(123)).toBe(enemyDepth(123));
    expect(ghostDepth("charA")).toBe(ghostDepth("charA"));
    // Full-band mapping = the raw hash.
    expect(enemyDepth(77)).toBe(hashUnit(77));
    expect(ghostDepth("z")).toBe(hashUnit("z"));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      const e = enemyDepth(i);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThan(1);
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    // The scatter really uses the whole band (not a narrow clump).
    expect(min).toBeLessThan(0.15);
    expect(max).toBeGreaterThan(0.85);
  });
});
