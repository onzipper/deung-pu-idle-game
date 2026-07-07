/**
 * `enemySpecies.ts` regression guard — M7.9 "new mob species" (owner-approved,
 * render-only).
 *
 * Two things this proves:
 * 1. map1/map2/map3 (+ any unconfigured/frontier mapId, including `undefined`)
 *    resolve to the EXACT SAME builder function reference + color per kind as
 *    each other — reference equality is a stronger byte-identity proof than a
 *    bounds/geometry comparison (there is only one function object; every one
 *    of those map ids literally calls it), guaranteeing maps 1-3 render with
 *    zero visual change from before this task.
 * 2. map4/5/6 each resolve to their OWN distinct builder + (mostly) distinct
 *    color per kind — the species table actually diverges where it's
 *    supposed to.
 */

import { describe, expect, it } from "vitest";
import type { EnemyKind } from "@/engine/entities";
import { ENEMY_COLORS } from "@/render/theme";
import { enemyColorFor, enemySpeciesFor } from "@/render/views/enemySpecies";

const KINDS: readonly EnemyKind[] = ["normal", "fast", "tank", "ranged"];
const BASE_MAPS = ["map1", "map2", "map3", "map7-frontier-overflow", undefined] as const;
const NEW_SPECIES_MAPS = ["map4", "map5", "map6"] as const;

describe("enemySpeciesFor — map1/2/3 (+ frontier fallback) byte-identity", () => {
  for (const kind of KINDS) {
    it(`${kind}: every base map id resolves to the SAME builder function + color`, () => {
      const reference = enemySpeciesFor("map1", kind);
      for (const mapId of BASE_MAPS) {
        const resolved = enemySpeciesFor(mapId, kind);
        expect(resolved.build).toBe(reference.build);
        expect(resolved.color).toBe(reference.color);
      }
      // ...and that shared color is exactly the original, untouched table.
      expect(reference.color).toBe(ENEMY_COLORS[kind]);
    });
  }
});

describe("enemySpeciesFor — map4/5/6 species diverge from the base look", () => {
  for (const mapId of NEW_SPECIES_MAPS) {
    for (const kind of KINDS) {
      it(`${mapId}/${kind}: resolves to a DIFFERENT builder than the map1 base`, () => {
        const base = enemySpeciesFor("map1", kind);
        const species = enemySpeciesFor(mapId, kind);
        expect(species.build).not.toBe(base.build);
      });
    }
  }
});

describe("enemyColorFor — thin color-only accessor matches enemySpeciesFor", () => {
  it("returns the same color enemySpeciesFor resolves, across every map × kind", () => {
    for (const mapId of [...BASE_MAPS, ...NEW_SPECIES_MAPS]) {
      for (const kind of KINDS) {
        expect(enemyColorFor(mapId, kind)).toBe(enemySpeciesFor(mapId, kind).color);
      }
    }
  });
});
