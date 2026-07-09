import { describe, expect, it } from "vitest";
import {
  clampDepth,
  DEPTH_OFFSET_FAR,
  DEPTH_OFFSET_NEAR,
  DEPTH_SCALE_FAR,
  DEPTH_SCALE_NEAR,
  depthOffsetY,
  depthScale,
  depthZIndex,
} from "@/lab/worldDepth/depthBand";
import { TERRAIN_MAX_OFFSET, TERRAIN_MIN_OFFSET } from "@/lab/worldDepth/terrain";
import { GROUND_Y, WORLD_HEIGHT } from "@/render/layout";

describe("worldDepth depth band — experiment ⑨", () => {
  it("depthScale and depthOffsetY are strictly increasing over [0,1]", () => {
    let prevScale = depthScale(0);
    let prevOffset = depthOffsetY(0);
    for (let i = 1; i <= 100; i++) {
      const d = i / 100;
      const s = depthScale(d);
      const o = depthOffsetY(d);
      expect(s).toBeGreaterThan(prevScale);
      expect(o).toBeGreaterThan(prevOffset);
      prevScale = s;
      prevOffset = o;
    }
  });

  it("depthZIndex preserves depth ordering (never folds the band)", () => {
    // Fine grid: never decreases.
    let prev = depthZIndex(0);
    for (let i = 1; i <= 1000; i++) {
      const z = depthZIndex(i / 1000);
      expect(z).toBeGreaterThanOrEqual(prev);
      prev = z;
    }
    // Coarse grid (actor-spacing scale): strictly increases.
    let prevCoarse = depthZIndex(0);
    for (let i = 1; i <= 20; i++) {
      const z = depthZIndex(i / 20);
      expect(z).toBeGreaterThan(prevCoarse);
      prevCoarse = z;
    }
  });

  it("clamps below 0 and above 1 to the band edges", () => {
    expect(clampDepth(-0.5)).toBe(0);
    expect(clampDepth(1.5)).toBe(1);
    expect(depthScale(-3)).toBe(depthScale(0));
    expect(depthScale(42)).toBe(depthScale(1));
    expect(depthOffsetY(-3)).toBe(depthOffsetY(0));
    expect(depthOffsetY(42)).toBe(depthOffsetY(1));
    expect(depthZIndex(-1)).toBe(0);
    expect(depthZIndex(2)).toBe(1000);
  });

  it("endpoints equal the exported knob consts", () => {
    expect(depthOffsetY(0)).toBe(DEPTH_OFFSET_FAR);
    expect(depthOffsetY(1)).toBe(DEPTH_OFFSET_NEAR);
    expect(depthScale(0)).toBeCloseTo(DEPTH_SCALE_FAR, 12);
    expect(depthScale(1)).toBeCloseTo(DEPTH_SCALE_NEAR, 12);
  });

  it("headroom budget: worst-case FEET line stays inside the 300px view", () => {
    // The experiment pivots actor roots at the rig feet line, so on screen
    //   feetY = terrain.groundY(x) + depthOffsetY(d)   (scale-independent).
    // Deepest terrain dip + nearest depth row is the plan's documented
    // worst case: 232 + 10 + 40 = 282 < WORLD_HEIGHT 300.
    const worstFeetY = GROUND_Y + TERRAIN_MAX_OFFSET + depthOffsetY(1);
    expect(worstFeetY).toBe(282);
    expect(worstFeetY).toBeLessThan(WORLD_HEIGHT);
    // And the far/high edge never rises above the sky band the silhouettes
    // reserve (sanity that the band + terrain crest stay on-screen too).
    const highestFeetY = GROUND_Y + TERRAIN_MIN_OFFSET + depthOffsetY(0);
    expect(highestFeetY).toBeGreaterThan(0);
  });
});
