/**
 * W3 "โลกมีมิติ" ground-layer promotion — terrain-tracking ground polygon +
 * sky-sliver backing strip (`groundBand.ts`) wired through `BiomeScene`, plus
 * `Environment`'s `terrainForZone`/`setTerrainEnabled` gating. Follows
 * `grandExpansion.test.ts`'s convention: real pixi.js `Graphics`/`Container`
 * building + `getBounds()` runs fine headless, so this exercises the actual
 * builders rather than re-deriving their geometry by hand.
 *
 * Flat zones (town/boss, and any farm zone whose hash-picked preset happens
 * to be "flat" — `terrainZone.ts`'s intentional variety pool) and the
 * terrain-feature-OFF path (no `terrain` ctor arg) must render TODAY's
 * `buildGroundBand` rect, byte-shape-identical; only a genuinely non-flat
 * farm zone gets the polygon + backing strip and a slope-conforming near-
 * props layer (covered separately in `parallaxLayer.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { initGameState, type Zone } from "@/engine";
import { BLEED_X, GROUND_Y, WORLD_WIDTH } from "@/render/layout";
import { biomeForZone } from "@/render/environment/biomes";
import { BiomeScene, GROUND_DEPTH } from "@/render/environment/BiomeScene";
import {
  buildGroundBackingStrip,
  buildGroundPolygon,
  sampleGroundLine,
} from "@/render/environment/groundBand";
import { Environment } from "@/render/environment/Environment";
import { createTerrain, type TerrainPresetId } from "@/render/worldDepth/terrain";
import { terrainForZone, terrainPresetForZone } from "@/render/worldDepth/terrainZone";

// Mirrors `BiomeScene`'s own ground-fill span (R2.5 "Game Screen" W1: the
// ground base fill widens by BLEED_X, not the far/near parallax's MARGIN).
const GROUND_X = -BLEED_X;
const GROUND_WIDTH = WORLD_WIDTH + BLEED_X * 2;
const STEP = 24;

/** Find the first farm zoneIdx (1..maxZoneIdx) on `mapId` whose hash-picked
 * terrain preset is exactly `preset` — deterministic (pure `hashUnit` under
 * the hood), so this is a stable search, not a randomized retry. */
function findFarmZoneWithPreset(mapId: string, preset: TerrainPresetId, maxZoneIdx = 60): Zone {
  for (let zoneIdx = 1; zoneIdx <= maxZoneIdx; zoneIdx++) {
    const zone: Zone = { mapId, zoneIdx, kind: "farm", stage: zoneIdx };
    if (terrainPresetForZone(zone) === preset) return zone;
  }
  throw new Error(`no farm zone with preset "${preset}" found on ${mapId} within ${maxZoneIdx} tries`);
}

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
}

describe("sampleGroundLine — pure top-edge sampler", () => {
  it("spans exactly [x, x+width] and every sample equals terrain.groundY at that x", () => {
    const terrain = createTerrain("hills", WORLD_WIDTH);
    const pts = sampleGroundLine(terrain, GROUND_X, GROUND_WIDTH, STEP);

    expect(pts.length % 2).toBe(0);
    expect(pts[0]).toBe(GROUND_X);
    expect(pts[pts.length - 2]).toBe(GROUND_X + GROUND_WIDTH);
    for (let i = 0; i < pts.length; i += 2) {
      const sx = pts[i]!;
      const sy = pts[i + 1]!;
      expect(Math.abs(sy - terrain.groundY(sx))).toBeLessThanOrEqual(1);
    }
  });
});

describe("terrain ground polygon — a real hills farm zone", () => {
  it("top edge tracks terrain.groundY(x) at sampled points (±1px), spans the full width", () => {
    const zone = findFarmZoneWithPreset("map1", "hills");
    expect(terrainPresetForZone(zone)).toBe("hills");
    const terrain = terrainForZone(zone);
    const biome = biomeForZone(zone);

    const pts = sampleGroundLine(terrain, GROUND_X, GROUND_WIDTH, STEP);
    for (let i = 0; i < pts.length; i += 2) {
      expect(Math.abs(pts[i + 1]! - terrain.groundY(pts[i]!))).toBeLessThanOrEqual(1);
    }

    const g = buildGroundPolygon(biome, terrain, GROUND_X, GROUND_Y, GROUND_WIDTH, GROUND_DEPTH, STEP);
    expectSaneBounds(g.getBounds());
    expect(g.getBounds().width).toBeGreaterThanOrEqual(GROUND_WIDTH - 4);
    g.destroy();
  });
});

describe("buildGroundBackingStrip — sky-sliver guard", () => {
  it("spans the full width at a fixed GROUND_Y-2..GROUND_Y+10 band", () => {
    const biome = biomeForZone({ mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 });
    const g = buildGroundBackingStrip(biome, GROUND_X, GROUND_Y, GROUND_WIDTH);
    const b = g.getBounds();
    expect(b.y).toBeCloseTo(GROUND_Y - 2, 0);
    expect(b.y + b.height).toBeCloseTo(GROUND_Y + 10, 0);
    expect(b.width).toBeGreaterThanOrEqual(GROUND_WIDTH - 2);
    g.destroy();
  });
});

describe("BiomeScene — flat zones and the terrain-off path render today's rect, shape-identical", () => {
  it("no opts (today's 3-arg call) vs explicit empty opts: identical child count", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 };
    const biome = biomeForZone(zone);
    const state = initGameState(1);

    const sceneOld = new BiomeScene(biome, zone, state);
    const sceneEmptyOpts = new BiomeScene(biome, zone, state, {});
    expect(sceneEmptyOpts.view.children.length).toBe(sceneOld.view.children.length);

    sceneOld.destroy();
    sceneEmptyOpts.destroy();
  });

  it("a boss-room zone keeps the plain rect even when a terrain object IS supplied", () => {
    // zoneIdx deliberately out of `findFarmZoneWithPreset`'s 1..60 search range
    // above — `terrainForZone`'s cache keys on mapId:zoneIdx alone (not kind),
    // so a shared zoneIdx with a farm-zone lookup elsewhere in this file could
    // silently reuse a cached entry instead of exercising this kind's own
    // (unconditionally flat) branch.
    const zone: Zone = { mapId: "map1", zoneIdx: 9001, kind: "boss", stage: 5 };
    expect(terrainPresetForZone(zone)).toBe("flat");
    const biome = biomeForZone(zone);
    const state = initGameState(1);

    const sceneOff = new BiomeScene(biome, zone, state);
    const sceneWithTerrain = new BiomeScene(biome, zone, state, { terrain: terrainForZone(zone) });
    expect(sceneWithTerrain.view.children.length).toBe(sceneOff.view.children.length);

    sceneOff.destroy();
    sceneWithTerrain.destroy();
  });

  it("a farm zone that hash-picked the 'flat' preset ALSO keeps the plain rect", () => {
    const zone = findFarmZoneWithPreset("map1", "flat");
    const biome = biomeForZone(zone);
    const state = initGameState(1);

    const sceneOff = new BiomeScene(biome, zone, state);
    const sceneWithTerrain = new BiomeScene(biome, zone, state, { terrain: terrainForZone(zone) });
    expect(sceneWithTerrain.view.children.length).toBe(sceneOff.view.children.length);

    sceneOff.destroy();
    sceneWithTerrain.destroy();
  });
});

describe("BiomeScene — a genuinely non-flat farm zone overlays the terrain polygon on the base fill", () => {
  it("adds exactly one extra top-level child (base fill + polygon vs the base fill alone) and survives update()", () => {
    const zone = findFarmZoneWithPreset("map1", "hills");
    const biome = biomeForZone(zone);
    const state = initGameState(1);

    const sceneOff = new BiomeScene(biome, zone, state);
    const sceneOn = new BiomeScene(biome, zone, state, { terrain: terrainForZone(zone) });
    expect(sceneOn.view.children.length).toBe(sceneOff.view.children.length + 1);

    for (let i = 0; i < 10; i++) expect(() => sceneOn.update(1 / 60, 1, state)).not.toThrow();

    sceneOff.destroy();
    sceneOn.destroy();
  });
});

describe("Environment — setTerrainEnabled default OFF, flips bust the crossfade", () => {
  it("default OFF: update() builds a scene without throwing", () => {
    const container = new Container();
    const env = new Environment(container);
    const state = initGameState(1);
    expect(() => env.update(1 / 60, state)).not.toThrow();
    expect(container.children.length).toBe(1);
    env.destroy();
  });

  it("setTerrainEnabled(true) after an initial spawn crossfades in a terrain-aware scene without throwing", () => {
    const container = new Container();
    const env = new Environment(container);
    const state = initGameState(1);
    env.update(1 / 60, state);

    env.setTerrainEnabled(true);
    for (let i = 0; i < 90; i++) expect(() => env.update(1 / 60, state)).not.toThrow(); // > 1s crossfade

    // Flipping back off must also be safe (a second crossfade).
    env.setTerrainEnabled(false);
    for (let i = 0; i < 90; i++) expect(() => env.update(1 / 60, state)).not.toThrow();

    env.destroy();
  });
});
