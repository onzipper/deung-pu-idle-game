import { describe, it, expect } from "vitest";
import { CONFIG, WORLD_ARC, arcAreaForMap, ASURA_MAP_ID, type ArcArea } from "@/engine";

// World Arc v1 data scaffolding (epic phase 4, docs/world-arc-freefield-v1.md §2).
// This suite is documentation-by-test: it pins the shape/order/naming of WORLD_ARC
// and the (owner-review) mapping onto today's engine maps. It does NOT exercise any
// behavior — WORLD_ARC is dormant by construction (no consumer reads it for gameplay).

const OWNER_LOCKED_NAMES = [
  "Capital Outskirts",
  "Farm Border Road",
  "Old Forest Path",
  "Moonshade Grove",
  "Forgotten Shrine",
  "Hollow Ravine",
  "Crystal Fault",
  "Ashen Gate",
  "Otherworld Verge",
  "Rift Sanctum",
] as const;

describe("WORLD_ARC data table", () => {
  it("has exactly 10 areas in owner-locked order with owner-locked English names", () => {
    expect(WORLD_ARC).toHaveLength(10);
    WORLD_ARC.forEach((area: ArcArea, i) => {
      expect(area.order).toBe(i + 1);
      expect(area.nameEn).toBe(OWNER_LOCKED_NAMES[i]);
    });
  });

  it("every area has a non-empty snake_case id and a non-empty themeHook", () => {
    for (const area of WORLD_ARC) {
      expect(area.id).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(area.themeHook.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = WORLD_ARC.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("areas 1-6 map 1:1 in order onto map1..map6 (smallest reversible default)", () => {
    const expected = ["map1", "map2", "map3", "map4", "map5", "map6"];
    const mapped = WORLD_ARC.slice(0, 6).map((a) => a.mapId);
    expect(mapped).toEqual(expected);
  });

  it("areas 7-10 (Crystal Fault..Rift Sanctum) are unmapped (future maps)", () => {
    const unmapped = WORLD_ARC.slice(6, 10);
    for (const area of unmapped) {
      expect(area.mapId).toBeUndefined();
    }
  });

  it("every claimed mapId exists in CONFIG.world.maps, and no map is claimed twice", () => {
    const configMapIds = new Set<string>(CONFIG.world.maps.map((m) => m.id));
    const claimed = WORLD_ARC.map((a) => a.mapId).filter(
      (id): id is NonNullable<ArcArea["mapId"]> => id !== undefined,
    );
    for (const id of claimed) {
      expect(configMapIds.has(id)).toBe(true);
    }
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("the asura endgame appendix map is never claimed by any arc area (outside the arc)", () => {
    const claimed: string[] = WORLD_ARC.map((a) => a.mapId).filter(
      (id): id is NonNullable<ArcArea["mapId"]> => id !== undefined,
    );
    expect(claimed).not.toContain(ASURA_MAP_ID);
  });

  it("arcAreaForMap resolves the mapped areas and returns undefined for unmapped/unknown ids", () => {
    expect(arcAreaForMap("map1")?.id).toBe("capital_outskirts");
    expect(arcAreaForMap("map6")?.id).toBe("hollow_ravine");
    expect(arcAreaForMap(ASURA_MAP_ID)).toBeUndefined();
    expect(arcAreaForMap("map99")).toBeUndefined();
  });

  it("is dormant: importing/reading the table does not touch any engine state", () => {
    // Pure data read — no step(), no state mutation. This test exists to document
    // the dormancy contract; a real behavior guard is out of scope for phase 4.
    expect(Array.isArray(WORLD_ARC)).toBe(true);
  });
});
