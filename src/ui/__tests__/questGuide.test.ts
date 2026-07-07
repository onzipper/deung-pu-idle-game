import { describe, expect, it } from "vitest";
import { selectQuestGuideTarget } from "@/ui/questGuide";

describe("selectQuestGuideTarget", () => {
  it("targets the highest unlocked farm zone for an unscoped kill objective (current map)", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: null, done: false },
      boss: { mapId: null, done: false },
      currentMapId: "map1",
      unlockedZones: { map1: 4 },
    });
    expect(target).toEqual({
      zone: { mapId: "map1", zoneIdx: 3, kind: "farm", stage: 3 },
      kind: "kill",
    });
  });

  it("targets the highest unlocked farm zone for a map-scoped kill objective (map3)", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: "map3", done: false },
      boss: { mapId: "map2", done: false },
      currentMapId: "map3",
      unlockedZones: { map3: 2 },
    });
    expect(target?.kind).toBe("kill");
    expect(target?.zone.mapId).toBe("map3");
    expect(target?.zone.zoneIdx).toBe(1);
  });

  it("falls through to the boss objective once kill is done, targeting the LAST farm zone of the boss's map", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: "map3", done: true },
      boss: { mapId: "map2", done: false },
      currentMapId: "map3",
      unlockedZones: { map2: 5, map3: 5 },
    });
    expect(target?.kind).toBe("boss");
    expect(target?.zone.mapId).toBe("map2");
    // map2 has no town zone: 5 farm zones (idx 0-4) then boss at idx 5.
    expect(target?.zone.zoneIdx).toBe(4);
    expect(target?.zone.kind).toBe("farm");
  });

  it("resolves an unscoped boss objective (tier-1 'any boss') to the current map", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: null, done: true },
      boss: { mapId: null, done: false },
      currentMapId: "map1",
      unlockedZones: { map1: 6 },
    });
    expect(target?.kind).toBe("boss");
    expect(target?.zone.mapId).toBe("map1");
    // map1: town(0) + farm(1..5) + boss(6) — last farm is idx 5.
    expect(target?.zone.zoneIdx).toBe(5);
  });

  it("returns null once both objectives are done", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: "map3", done: true },
      boss: { mapId: "map2", done: true },
      currentMapId: "map3",
      unlockedZones: { map2: 5, map3: 5 },
    });
    expect(target).toBeNull();
  });

  it("returns null for a kill objective whose map has no unlocked farm zone yet", () => {
    const target = selectQuestGuideTarget({
      kill: { mapId: "map3", done: false },
      boss: { mapId: "map2", done: false },
      currentMapId: "map3",
      unlockedZones: {},
    });
    expect(target).toBeNull();
  });
});
