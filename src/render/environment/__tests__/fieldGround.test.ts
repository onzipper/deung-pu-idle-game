/**
 * FREE-FIELD (Phase 2) — the placeholder ground plane must cover the WHOLE
 * walkable field (the far row lifted toward the horizon down past the near row +
 * contact-shadow room), and a tap ANYWHERE in the field must map into the engine
 * field-rect's y extents. Pure headless: real pixi `Graphics.getBounds()` (same
 * convention as `terrainGround.test.ts`) + the pure `tapToPlaneY` seam + the
 * engine `fieldRect` seam — no hand-restated geometry.
 */

import { describe, expect, it } from "vitest";
import { initGameState, fieldRect, type Zone } from "@/engine";
import { BLEED_X, GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import {
  DEPTH_OFFSET_FAR,
  DEPTH_OFFSET_NEAR,
} from "@/render/worldDepth/depthBand";
import { tapToPlaneY } from "@/render/worldDepth/hitTestMath";
import { biomeForZone } from "@/render/environment/biomes";
import {
  BiomeScene,
  FIELD_GROUND_DEPTH,
  HORIZON_Y,
} from "@/render/environment/BiomeScene";
import { buildGroundBand } from "@/render/environment/groundBand";

const GROUND_X = -BLEED_X;
const GROUND_WIDTH = WORLD_WIDTH + BLEED_X * 2;

/** On-screen feet y at the field's far (upstage) / near (downstage) rows. */
const FAR_FEET = GROUND_Y + DEPTH_OFFSET_FAR;
const NEAR_FEET = GROUND_Y + DEPTH_OFFSET_NEAR;
/** Contact-shadow ellipse room drawn BELOW the deepest feet — the 2px near-edge
 * clip Phase 2 fixed by growing WORLD_HEIGHT; the base fill must cover it. */
const SHADOW_ROOM = 10;

describe("field ground coverage — the base fill covers the full walkable field", () => {
  it("tops out at/above the far row and reaches past the near row + shadow room", () => {
    const biome = biomeForZone({ mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 });
    const g = buildGroundBand(biome, GROUND_X, HORIZON_Y, GROUND_WIDTH, FIELD_GROUND_DEPTH);
    const b = g.getBounds();
    // Top edge sits at/above the far row (so far-row actors stand ON ground).
    expect(b.y).toBeLessThanOrEqual(FAR_FEET);
    // Bottom edge runs well past the near row + shadow room.
    expect(b.y + b.height).toBeGreaterThanOrEqual(NEAR_FEET + SHADOW_ROOM);
    g.destroy();
  });

  it("HORIZON_Y sits above the far row; the base fill's bottom clears the near row", () => {
    expect(HORIZON_Y).toBeLessThanOrEqual(FAR_FEET);
    expect(HORIZON_Y + FIELD_GROUND_DEPTH).toBeGreaterThanOrEqual(NEAR_FEET + SHADOW_ROOM);
    // And it never rises off the top of the logical world.
    expect(HORIZON_Y).toBeGreaterThan(0);
    // Bottom lands inside the decorative ground bleed, past WORLD_HEIGHT.
    expect(HORIZON_Y + FIELD_GROUND_DEPTH).toBeGreaterThan(WORLD_HEIGHT);
  });

  it("every biome family + town + boss builds a scene that survives update()", () => {
    const state = initGameState(1);
    const zones: Zone[] = [
      { mapId: "map1", zoneIdx: 0, kind: "town", stage: 0 },
      { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 },
      { mapId: "map3", zoneIdx: 2, kind: "farm", stage: 12 },
      { mapId: "map1", zoneIdx: 6, kind: "boss", stage: 6 },
    ];
    for (const zone of zones) {
      const scene = new BiomeScene(biomeForZone(zone), zone, state);
      for (let i = 0; i < 5; i++) expect(() => scene.update(1 / 60, 1, state)).not.toThrow();
      // The whole scene's ground reaches below the near row (sanity the field is covered).
      expect(scene.view.getBounds().y + scene.view.getBounds().height).toBeGreaterThanOrEqual(NEAR_FEET);
      scene.destroy();
    }
  });
});

describe("tap-anywhere — full field maps into the engine field-rect y extents", () => {
  it("render depth-band edges equal the engine field-rect y extents (tap↔field parity)", () => {
    const f = fieldRect("map1");
    expect(DEPTH_OFFSET_FAR).toBe(f.minY);
    expect(DEPTH_OFFSET_NEAR).toBe(f.maxY);
  });

  it("a tap at the far/near feet rows inverts to the field's min/max y", () => {
    const f = fieldRect("map1");
    expect(tapToPlaneY(FAR_FEET, GROUND_Y, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR)).toBeCloseTo(f.minY, 9);
    expect(tapToPlaneY(NEAR_FEET, GROUND_Y, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR)).toBeCloseTo(f.maxY, 9);
  });

  it("taps past either edge saturate to the field edge; a mid-field tap stays in range", () => {
    const f = fieldRect("map1");
    expect(tapToPlaneY(GROUND_Y - 500, GROUND_Y, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR)).toBe(f.minY);
    expect(tapToPlaneY(GROUND_Y + 500, GROUND_Y, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR)).toBe(f.maxY);
    const mid = tapToPlaneY(GROUND_Y + 5, GROUND_Y, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR);
    expect(mid).toBeGreaterThanOrEqual(f.minY);
    expect(mid).toBeLessThanOrEqual(f.maxY);
  });
});
