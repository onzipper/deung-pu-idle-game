/**
 * Forest Road ground composition (R4.5 Wave 2B, issue #69) — the map2 farm
 * ground layer (tone strips + dirt-road S-curve). Follows the
 * `terrainGround.test.ts` / `asura.test.ts` convention: real pixi.js
 * `Graphics`/`Container` building runs fine headless, so the BiomeScene tests
 * exercise the actual builders, while the pure geometry/color helpers are
 * unit-tested directly.
 *
 * Covers: (1) gating — only map2 farm zones activate; (2) composition present
 * in a map2 farm scene, ABSENT in town/boss/other maps (byte-identical gate);
 * (3) tone strips sit within the depth-band envelope; (4) far strip darker
 * than near (derive-color); (5) road fades at gates; (6) build-once — no
 * children added on repeated update().
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { initGameState, type Zone } from "@/engine";
import { GROUND_Y, WORLD_WIDTH } from "@/render/layout";
import { DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR } from "@/render/worldDepth/depthBand";
import { gateX } from "@/render/environment/zoneGates";
import { biomeForZone } from "@/render/environment/biomes";
import { BiomeScene } from "@/render/environment/BiomeScene";
import {
  FOREST_ROAD_LABEL,
  forestRoadActiveForZone,
  forestRoadStrips,
  roadGateFadeAt,
} from "@/render/environment/forestRoad";

function map2Farm(zoneIdx: number): Zone {
  return { mapId: "map2", zoneIdx, kind: "farm", stage: zoneIdx };
}

/** Perceived-brightness proxy (channel sum) — no HSL helper is exported and
 * this is monotonic enough to compare a darkened vs a lighter tone. */
function brightness(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}

function hasForestRoad(scene: BiomeScene): boolean {
  return scene.view.children.some((c) => c.label === FOREST_ROAD_LABEL);
}

describe("forestRoadActiveForZone — gating", () => {
  it("true for every map2 farm zone", () => {
    for (let z = 1; z <= 5; z++) expect(forestRoadActiveForZone(map2Farm(z))).toBe(true);
  });

  it("false for map2 boss, and for other maps' farm zones", () => {
    expect(forestRoadActiveForZone({ mapId: "map2", zoneIdx: 6, kind: "boss", stage: 10 })).toBe(false);
    expect(forestRoadActiveForZone({ mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 })).toBe(false);
    expect(forestRoadActiveForZone({ mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 })).toBe(false);
    expect(forestRoadActiveForZone({ mapId: "map3", zoneIdx: 1, kind: "farm", stage: 1 })).toBe(false);
  });
});

describe("forestRoadStrips — geometry within the depth-band envelope, far darker than near", () => {
  const biome = biomeForZone(map2Farm(1));
  const strips = forestRoadStrips(biome, GROUND_Y);

  it("every strip sits within [GROUND_Y + DEPTH_OFFSET_FAR, GROUND_Y + DEPTH_OFFSET_NEAR]", () => {
    const top = GROUND_Y + DEPTH_OFFSET_FAR;
    const bottom = GROUND_Y + DEPTH_OFFSET_NEAR;
    expect(strips.length).toBeGreaterThanOrEqual(2);
    for (const s of strips) {
      expect(s.top).toBeGreaterThanOrEqual(top - 1e-6);
      expect(s.top + s.height).toBeLessThanOrEqual(bottom + 1e-6);
      expect(s.height).toBeGreaterThan(0);
    }
    // Strips together span the whole band, contiguously.
    expect(strips[0]!.top).toBeCloseTo(top, 6);
    expect(strips[strips.length - 1]!.top + strips[strips.length - 1]!.height).toBeCloseTo(bottom, 6);
  });

  it("far strip (index 0) is darker than the near strip (last)", () => {
    expect(brightness(strips[0]!.color)).toBeLessThan(brightness(strips[strips.length - 1]!.color));
  });
});

describe("roadGateFadeAt — road fades toward the walk gates", () => {
  const gl = gateX("map2", "left");
  const gr = gateX("map2", "right");

  it("is 0 exactly at a gate and ~1 mid-field", () => {
    expect(roadGateFadeAt(gl, gl, gr)).toBe(0);
    expect(roadGateFadeAt(gr, gl, gr)).toBe(0);
    expect(roadGateFadeAt(WORLD_WIDTH / 2, gl, gr)).toBeCloseTo(1, 6);
  });

  it("is monotonic rising away from the left gate", () => {
    const a = roadGateFadeAt(gl + 20, gl, gr);
    const b = roadGateFadeAt(gl + 60, gl, gr);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
  });
});

describe("BiomeScene — forest-road composition present only for map2 farm zones", () => {
  it("a map2 farm scene contains exactly one forest-road container", () => {
    const zone = map2Farm(1);
    const state = initGameState(1);
    const scene = new BiomeScene(biomeForZone(zone), zone, state);
    const matches = scene.view.children.filter((c) => c.label === FOREST_ROAD_LABEL);
    expect(matches.length).toBe(1);
    scene.destroy();
  });

  it("map2 boss, map1 farm, and town scenes contain NO forest-road container", () => {
    const state = initGameState(1);
    const cases: Zone[] = [
      { mapId: "map2", zoneIdx: 6, kind: "boss", stage: 10 },
      { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 },
      { mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 },
      { mapId: "map3", zoneIdx: 1, kind: "farm", stage: 1 },
    ];
    for (const zone of cases) {
      const scene = new BiomeScene(biomeForZone(zone), zone, state);
      expect(hasForestRoad(scene)).toBe(false);
      scene.destroy();
    }
  });
});

describe("BiomeScene — forest road is build-once (no per-frame children)", () => {
  it("repeated update() adds no children to the road container or the scene", () => {
    const zone = map2Farm(2);
    const state = initGameState(1);
    state.location = { mapId: zone.mapId, zoneIdx: zone.zoneIdx };
    const scene = new BiomeScene(biomeForZone(zone), zone, state);

    const road = scene.view.children.find((c) => c.label === FOREST_ROAD_LABEL) as Container;
    expect(road).toBeTruthy();
    const roadChildren = road.children.length;
    const sceneChildren = scene.view.children.length;

    for (let i = 0; i < 20; i++) scene.update(1 / 60, 0, state);

    expect(road.children.length).toBe(roadChildren);
    expect(scene.view.children.length).toBe(sceneChildren);
    scene.destroy();
  });
});
