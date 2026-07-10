import { describe, expect, it } from "vitest";
import {
  createWorldFxContext,
  DEPTH_NEUTRAL,
  planeToDepth,
} from "@/render/worldDepth/worldFxContext";
import { terrainForZone } from "@/render/worldDepth/terrainZone";
import { depthOffsetY, depthScale } from "@/render/worldDepth/depthBand";
import { GROUND_Y } from "@/render/layout";
import { enemyPlaneY, scatterPlaneY, heroPlaneY, hashUnit } from "@/engine";
import type { Zone } from "@/engine";

const farm: Zone = { mapId: "map1", zoneIdx: 3, kind: "farm", stage: 3 };
const XS = [0, 55, 200, 460, 700, 876, 900];

describe("worldDepth fx context (the shared seam)", () => {
  it("DEPTH_NEUTRAL is the exact zero-lift row (offset 0)", () => {
    expect(depthOffsetY(DEPTH_NEUTRAL)).toBe(0);
    expect(DEPTH_NEUTRAL).toBeCloseTo(0.375, 12);
  });

  it("flags OFF is bit-identical to today (flat ground, no depth)", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: false, terrain: false });
    ctx.setZone(farm); // a rolling zone is bound but OFF must ignore it
    for (const x of XS) {
      expect(ctx.groundY(x)).toBe(GROUND_Y);
      expect(ctx.footY(x, 0.2)).toBe(GROUND_Y);
      expect(ctx.footY(x, 0.9)).toBe(GROUND_Y);
      expect(ctx.lift(x)).toBe(0);
    }
    for (const [kind, id] of [
      ["enemy", 123],
      ["hero", 0],
      ["ghost", "abc"],
    ] as const) {
      const d = ctx.depthOf(kind, id);
      expect(d).toBe(DEPTH_NEUTRAL);
      expect(depthOffsetY(d)).toBe(0); // offset 0
      expect(ctx.depthScaleOf(d)).toBe(1); // scale 1
    }
  });

  it("flags ON: terrain from terrainForZone; depth inverts the engine planeY", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: true, terrain: true });
    ctx.setZone(farm);
    const terrain = terrainForZone(farm);
    for (const x of XS) {
      expect(ctx.groundY(x)).toBe(terrain.groundY(x));
      expect(ctx.lift(x)).toBeCloseTo(terrain.groundY(x) - GROUND_Y, 12);
    }
    // Depth is engine-owned (R4 Wave C0): the seam inverts the entity's engine
    // `planeY` via `planeToDepth` — no render-side hash assignment anymore.
    const ey = enemyPlaneY(77);
    expect(ctx.depthOf("enemy", 77, undefined, undefined, ey)).toBe(planeToDepth(ey));
    const gy = scatterPlaneY("charX");
    expect(ctx.depthOf("ghost", "charX", undefined, undefined, gy)).toBe(planeToDepth(gy));
    const hy = heroPlaneY("swordsman", 2, 6);
    expect(ctx.depthOf("hero", 0, 2, 6, hy)).toBe(planeToDepth(hy));
    const d = planeToDepth(ey);
    expect(ctx.footY(123, d)).toBeCloseTo(terrain.groundY(123) + depthOffsetY(d), 12);
    expect(ctx.depthScaleOf(d)).toBe(depthScale(d));
  });

  it("flags ON, no planeY: defensive fallback is a stable id-hash row (not neutral)", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: true, terrain: false });
    ctx.setZone(null);
    // A stray actor with no engine `planeY` should not happen post-Wave-A, but the
    // seam degrades deterministically to hashUnit(id) rather than the flat neutral
    // line — the same value the engine's enemyPlaneY/scatterPlaneY invert to.
    expect(ctx.depthOf("enemy", 77)).toBe(hashUnit(77));
    expect(ctx.depthOf("ghost", "charX")).toBe(hashUnit("charX"));
    expect(ctx.depthOf("enemy", 77)).not.toBe(DEPTH_NEUTRAL);
    expect(ctx.depthOf("enemy", 77)).toBe(ctx.depthOf("enemy", 77)); // deterministic
  });

  it("terrain and depth flags are independent", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: false, terrain: true });
    ctx.setZone(farm);
    const terrain = terrainForZone(farm);
    expect(ctx.groundY(300)).toBe(terrain.groundY(300)); // terrain ON
    expect(ctx.footY(300, 0.9)).toBe(terrain.groundY(300)); // depth OFF → no offset
    expect(ctx.depthScaleOf(0.9)).toBe(1); // depth OFF → scale 1
    expect(ctx.depthOf("enemy", 5)).toBe(DEPTH_NEUTRAL); // depth OFF
  });

  it("setZone(null) → flat ground even with terrain ON", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: true, terrain: true });
    ctx.setZone(null);
    for (const x of [0, 300, 900]) expect(ctx.groundY(x)).toBe(GROUND_Y);
  });

  it("zero re-alloc: setZone reuses the cached Terrain instance", () => {
    const ctx = createWorldFxContext();
    ctx.setFlags({ depth: true, terrain: true });
    const z: Zone = { mapId: "map4", zoneIdx: 2, kind: "farm", stage: 17 };
    const t1 = terrainForZone(z); // seed the cache
    ctx.setZone(z);
    const g1 = ctx.groundY(400);
    ctx.setZone(z); // rebind same zone
    expect(ctx.groundY(400)).toBe(g1);
    expect(terrainForZone(z)).toBe(t1); // proves no rebuild happened
  });
});
