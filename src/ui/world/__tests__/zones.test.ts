import { describe, expect, it } from "vitest";
import {
  UI_WORLD_ZONES,
  fastTravelTargets,
  farmZonesForMap,
  firstFarmZone,
  highestUnlockedFarmZone,
  isZoneUnlockedUi,
  lastFarmZone,
  zonesGroupedByMap,
} from "@/ui/world/zones";

describe("UI_WORLD_ZONES", () => {
  it("puts the town at map1 zoneIdx 0", () => {
    const town = UI_WORLD_ZONES.find((z) => z.kind === "town");
    expect(town).toEqual({ mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 });
  });

  it("lays out map1 as town + 5 farm zones + boss", () => {
    const map1 = UI_WORLD_ZONES.filter((z) => z.mapId === "map1");
    expect(map1.map((z) => z.kind)).toEqual([
      "town",
      "farm",
      "farm",
      "farm",
      "farm",
      "farm",
      "boss",
    ]);
    expect(map1[map1.length - 1].stage).toBe(5);
  });

  it("lays out map2/map3 as farm-only + boss (no second town)", () => {
    for (const mapId of ["map2", "map3"]) {
      const zones = UI_WORLD_ZONES.filter((z) => z.mapId === mapId);
      expect(zones.some((z) => z.kind === "town")).toBe(false);
      expect(zones[zones.length - 1].kind).toBe("boss");
    }
  });
});

describe("fastTravelTargets", () => {
  it("excludes every boss room", () => {
    expect(fastTravelTargets().some((z) => z.kind === "boss")).toBe(false);
  });

  it("includes town + farm zones", () => {
    const kinds = new Set(fastTravelTargets().map((z) => z.kind));
    expect(kinds.has("town")).toBe(true);
    expect(kinds.has("farm")).toBe(true);
  });
});

describe("zonesGroupedByMap", () => {
  it("groups preserving per-map order", () => {
    const groups = zonesGroupedByMap(UI_WORLD_ZONES);
    const map1 = groups.find((g) => g.mapId === "map1");
    expect(map1?.zones[0].kind).toBe("town");
    expect(map1?.zones.map((z) => z.zoneIdx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("isZoneUnlockedUi", () => {
  it("is unlocked when zoneIdx is below the map's unlocked count", () => {
    expect(isZoneUnlockedUi({ mapId: "map1", zoneIdx: 0 }, { map1: 3 })).toBe(true);
    expect(isZoneUnlockedUi({ mapId: "map1", zoneIdx: 2 }, { map1: 3 })).toBe(true);
  });

  it("is locked at/above the unlocked count, or with no entry at all", () => {
    expect(isZoneUnlockedUi({ mapId: "map1", zoneIdx: 3 }, { map1: 3 })).toBe(false);
    expect(isZoneUnlockedUi({ mapId: "map2", zoneIdx: 0 }, { map1: 3 })).toBe(false);
  });
});

describe("farmZonesForMap / lastFarmZone / highestUnlockedFarmZone", () => {
  it("lists only farm-kind zones for a map, in ascending zoneIdx order", () => {
    const farms = farmZonesForMap("map2");
    expect(farms.map((z) => z.kind)).toEqual(["farm", "farm", "farm", "farm", "farm"]);
    expect(farms.map((z) => z.zoneIdx)).toEqual([0, 1, 2, 3, 4]);
  });

  it("lastFarmZone is the zone right before the boss room", () => {
    expect(lastFarmZone("map2")).toEqual({
      mapId: "map2",
      zoneIdx: 4,
      kind: "farm",
      stage: 10,
    });
  });

  it("highestUnlockedFarmZone picks the deepest reachable farm zone", () => {
    expect(highestUnlockedFarmZone("map3", { map3: 2 })?.zoneIdx).toBe(1);
    expect(highestUnlockedFarmZone("map3", {})).toBeNull();
  });

  it("firstFarmZone is map4's frontier field (zone 0) — the tier-3 quest's granted zone", () => {
    expect(firstFarmZone("map4")).toEqual({
      mapId: "map4",
      zoneIdx: 0,
      kind: "farm",
      stage: 16,
    });
  });
});
