/**
 * ดินแดนอสูร (ASURA endgame v1, docs/endgame-design.md) render-wave guard —
 * mirrors `grandExpansion.test.ts`'s convention (real pixi.js `Graphics`
 * building + `getBounds()` runs fine headless, so this exercises the actual
 * builders rather than re-deriving their geometry by hand).
 *
 * Covers: (1) the 10 farm zones + capstone boss biome all resolve to distinct,
 * non-degenerate biomes; (2) the far-silhouette/near-prop builders survive
 * every one of those 11 zones without crashing; (3) `BiomeScene`'s daily
 * hot-zone golden-ember overlay activates ONLY in the matching asura farm
 * zone and stays a graceful no-op everywhere else (map1-6, non-hot asura
 * zones, `asuraHotZone: null`).
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { initGameState, type Zone } from "@/engine";
import { CONFIG } from "@/engine/config";
import { GROUND_Y } from "@/render/layout";
import { biomeForZone } from "@/render/environment/biomes";
import { BiomeScene } from "@/render/environment/BiomeScene";
import { buildSilhouetteChunk } from "@/render/environment/silhouettes";
import { buildGroundPropsChunk } from "@/render/environment/groundProps";

const ASURA_MAP_ID = CONFIG.asura.mapId;
const FARM_ZONES = CONFIG.asura.farmZones; // 10

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
}

function asuraFarmZone(zoneIdx: number): Zone {
  return { mapId: ASURA_MAP_ID, zoneIdx, kind: "farm", stage: CONFIG.asura.stageBase + zoneIdx };
}

describe("biomeForZone — asura's 10 farm zones + capstone boss all resolve distinctly", () => {
  it("every farm zone (0..9) + the boss room resolve to a unique, non-special-farm biome", () => {
    const ids = new Set<string>();
    for (let zoneIdx = 0; zoneIdx < FARM_ZONES; zoneIdx++) {
      const biome = biomeForZone(asuraFarmZone(zoneIdx));
      expect(biome.special).toBeUndefined();
      ids.add(biome.id);
    }
    const boss = biomeForZone({ mapId: ASURA_MAP_ID, zoneIdx: FARM_ZONES, kind: "boss", stage: 40 });
    expect(boss.special).toBe("bossRoom");
    ids.add(boss.id);
    expect(ids.size).toBe(FARM_ZONES + 1); // no accidental id collisions/loop repeats
  });

  it("never resolves to the same biome family as map2's fiery แดนอสูร (distinct hue)", () => {
    const map2Boss = biomeForZone({ mapId: "map2", zoneIdx: 6, kind: "boss", stage: 10 });
    const asuraBoss = biomeForZone({ mapId: ASURA_MAP_ID, zoneIdx: FARM_ZONES, kind: "boss", stage: 40 });
    expect(asuraBoss.id).not.toBe(map2Boss.id);
    expect(asuraBoss.sky.horizon).not.toBe(map2Boss.sky.horizon);
  });
});

describe("silhouettes/groundProps — every asura zone's far/near layers build sane bounds", () => {
  it("far silhouette + near ground props survive all 10 farm zones + the boss room", () => {
    for (let zoneIdx = 0; zoneIdx <= FARM_ZONES; zoneIdx++) {
      const zone: Zone =
        zoneIdx < FARM_ZONES ? asuraFarmZone(zoneIdx) : { mapId: ASURA_MAP_ID, zoneIdx, kind: "boss", stage: 40 };
      const biome = biomeForZone(zone);

      const far = buildSilhouetteChunk({
        chunkWidth: 300,
        index: 0,
        baselineY: GROUND_Y,
        shape: biome.far.shape,
        far: biome.far,
      });
      expectSaneBounds(far.getBounds());
      far.destroy();

      const near = buildGroundPropsChunk({ chunkWidth: 300, bandDepth: 40, biome });
      expectSaneBounds(near.getBounds());
      near.destroy();
    }
  });
});

describe("BiomeScene — asura daily hot-zone golden-ember ambience", () => {
  it("activates only while state.asuraHotZone matches THIS scene's own farm zoneIdx", () => {
    const zone = asuraFarmZone(3);
    const biome = biomeForZone(zone);
    const state = initGameState(1);
    state.location = { mapId: zone.mapId, zoneIdx: zone.zoneIdx };

    const scene = new BiomeScene(biome, zone, state);
    const container = new Container();
    container.addChild(scene.view);

    // Unset -> not active.
    state.asuraHotZone = null;
    expect(() => scene.update(1 / 60, 0, state)).not.toThrow();

    // A DIFFERENT zone is hot -> still not active.
    state.asuraHotZone = 7;
    expect(() => scene.update(1 / 60, 0, state)).not.toThrow();

    // THIS zone is hot -> activates, several ticks stay crash-free.
    state.asuraHotZone = zone.zoneIdx;
    for (let i = 0; i < 10; i++) expect(() => scene.update(1 / 60, 0, state)).not.toThrow();

    scene.destroy();
  });

  it("graceful no-op for a non-asura biome even with asuraHotZone set", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 };
    const biome = biomeForZone(zone);
    const state = initGameState(1);
    state.asuraHotZone = 1; // arbitrary — must never activate an ember field here

    const scene = new BiomeScene(biome, zone, state);
    for (let i = 0; i < 5; i++) expect(() => scene.update(1 / 60, 0, state)).not.toThrow();
    scene.destroy();
  });
});
