/**
 * M7.9 "Grand Expansion" render-world smoke/bounds guard — the 3 new biome
 * families (map4 ice tundra s16-20, map5 desert ruins s21-25, map6 hell city
 * s26-30). Follows `gates.test.ts`'s convention: real pixi.js `Graphics`
 * building + `getBounds()` runs fine headless, so this exercises the actual
 * builders rather than re-deriving their geometry by hand.
 *
 * `biomeForZone` resolves purely off `MAP_THEMES`/zone shape (no dependency on
 * `CONFIG.world.maps` knowing about map4/5/6 yet — that lands with the
 * parallel engine work), so a hand-built `Zone` with `mapId: "map4"` etc.
 * already exercises the real theme data end to end.
 */

import { describe, expect, it } from "vitest";
import type { Zone } from "@/engine";
import { biomeForZone } from "@/render/environment/biomes";
import { buildSilhouetteChunk } from "@/render/environment/silhouettes";
import { buildGroundPropsChunk } from "@/render/environment/groundProps";
import { buildZoneGateArch } from "@/render/environment/gateArch";
import { BossDoorProp } from "@/render/environment/bossDoor";
import { GROUND_Y } from "@/render/layout";

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
}

const NEW_MAPS = ["map4", "map5", "map6"] as const;

describe("biomeForZone — new map families resolve distinct, non-repeating farm+boss biomes", () => {
  for (const mapId of NEW_MAPS) {
    it(`${mapId}: 5 farm zones + a dedicated boss biome, all distinct ids`, () => {
      const ids = new Set<string>();
      for (let zoneIdx = 1; zoneIdx <= 5; zoneIdx++) {
        const zone: Zone = { mapId, zoneIdx, kind: "farm", stage: zoneIdx };
        const biome = biomeForZone(zone);
        expect(biome.special).toBeUndefined();
        ids.add(biome.id);
      }
      const bossZone: Zone = { mapId, zoneIdx: 6, kind: "boss", stage: 5 };
      const boss = biomeForZone(bossZone);
      expect(boss.special).toBe("bossRoom");
      ids.add(boss.id);
      expect(ids.size).toBe(6); // 5 farm + boss, no accidental repeats
    });
  }
});

describe("silhouettes — new shapes (ruins, infernal-skyline) build sane, non-degenerate bounds", () => {
  for (const mapId of NEW_MAPS) {
    it(`${mapId}: every farm+boss zone's far silhouette has sane bounds`, () => {
      for (let zoneIdx = 1; zoneIdx <= 6; zoneIdx++) {
        const zone: Zone =
          zoneIdx <= 5
            ? { mapId, zoneIdx, kind: "farm", stage: zoneIdx }
            : { mapId, zoneIdx, kind: "boss", stage: 5 };
        const biome = biomeForZone(zone);
        const g = buildSilhouetteChunk({
          chunkWidth: 300,
          index: 0,
          baselineY: GROUND_Y,
          shape: biome.far.shape,
          far: biome.far,
        });
        expectSaneBounds(g.getBounds());
        g.destroy();
      }
    });
  }
});

describe("groundProps — new propStyles (snow, rubble, cracks) build sane, non-degenerate bounds", () => {
  for (const mapId of NEW_MAPS) {
    it(`${mapId}: every farm+boss zone's near ground props have sane bounds`, () => {
      for (let zoneIdx = 1; zoneIdx <= 6; zoneIdx++) {
        const zone: Zone =
          zoneIdx <= 5
            ? { mapId, zoneIdx, kind: "farm", stage: zoneIdx }
            : { mapId, zoneIdx, kind: "boss", stage: 5 };
        const biome = biomeForZone(zone);
        const g = buildGroundPropsChunk({ chunkWidth: 300, bandDepth: 40, biome });
        expectSaneBounds(g.getBounds());
        g.destroy();
      }
    });
  }
});

describe("gateArch — the 3 new families build without crashing, sane bounds", () => {
  for (const family of NEW_MAPS) {
    it(`${family}: archway builds fine using its own farm zone1 biome`, () => {
      const zone: Zone = { mapId: family, zoneIdx: 1, kind: "farm", stage: 1 };
      const biome = biomeForZone(zone);
      const view = buildZoneGateArch(family, 100, GROUND_Y, biome);
      expectSaneBounds(view.getBounds());
      view.destroy({ children: true });
    });
  }
});

describe("BossDoorProp — the 3 new families cycle locked <-> unlocked without collapsing", () => {
  for (const family of NEW_MAPS) {
    it(`${family}: builds, holds locked, eases open, stays sane`, () => {
      const zone: Zone = { mapId: family, zoneIdx: 5, kind: "farm", stage: 5 };
      const biome = biomeForZone(zone);
      const door = new BossDoorProp(0, GROUND_Y, family, biome);

      door.setUnlocked(false);
      for (let i = 0; i < 5; i++) door.update(1 / 60);
      expectSaneBounds(door.view.getBounds());

      door.setUnlocked(true);
      for (let i = 0; i < 120; i++) door.update(1 / 60);
      expectSaneBounds(door.view.getBounds());

      door.destroy();
    });
  }
});
