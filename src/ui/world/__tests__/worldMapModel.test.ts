import { describe, expect, it } from "vitest";
import { ASURA_MAP_ID } from "@/engine";
import { fastTravelTargets, zonesGroupedByMap } from "@/ui/world/zones";
import { buildWorldMapModel, sumCounts, zoneKeyOf } from "@/ui/world/worldMapModel";

const GROUPED = zonesGroupedByMap(fastTravelTargets());

function baseInput() {
  return {
    groupedZones: GROUPED,
    unlockedZones: { map1: 6 }, // town(0) + 5 farm zones unlocked
    myZoneKey: "map1:1",
    counts: null as Record<string, number> | null,
    friends: [],
    partyMemberNames: [],
    bossWindowMapId: null as string | null,
  };
}

describe("buildWorldMapModel", () => {
  it("marks zones unlocked/locked per unlockedZones", () => {
    const sections = buildWorldMapModel(baseInput());
    const map1 = sections.find((s) => s.mapId === "map1")!;
    const town = map1.rows.find((r) => r.zoneIdx === 0)!;
    const farm1 = map1.rows.find((r) => r.zoneIdx === 1)!;
    expect(town.unlocked).toBe(true);
    expect(farm1.unlocked).toBe(true);

    const map2 = sections.find((s) => s.mapId === "map2")!;
    // map2 has no unlockedZones entry at all -> everything locked.
    expect(map2.rows.every((r) => !r.unlocked)).toBe(true);
  });

  it("counts=null degrades every row's count to null", () => {
    const sections = buildWorldMapModel(baseInput());
    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.count).toBeNull();
      }
    }
  });

  it("reads a positive count off the counts map for the matching zoneKey", () => {
    const sections = buildWorldMapModel({
      ...baseInput(),
      counts: { "map1:1": 4, "map1:2": 0 },
    });
    const map1 = sections.find((s) => s.mapId === "map1")!;
    expect(map1.rows.find((r) => r.zoneIdx === 1)!.count).toBe(4);
    // present but zero, and simply absent, both degrade to null (never a "0" badge).
    expect(map1.rows.find((r) => r.zoneIdx === 2)!.count).toBeNull();
    expect(map1.rows.find((r) => r.zoneIdx === 3)!.count).toBeNull();
  });

  it("flags isMe on exactly my current zoneKey", () => {
    const sections = buildWorldMapModel({ ...baseInput(), myZoneKey: "map1:1" });
    const map1 = sections.find((s) => s.mapId === "map1")!;
    expect(map1.rows.find((r) => r.zoneIdx === 1)!.isMe).toBe(true);
    expect(map1.rows.find((r) => r.zoneIdx === 0)!.isMe).toBe(false);
  });

  it("buckets friends by lastZone into initials, capped at 3 with overflow", () => {
    const sections = buildWorldMapModel({
      ...baseInput(),
      friends: [
        { displayName: "Ann", lastZone: "map1:2" },
        { displayName: "bob", lastZone: "map1:2" },
        { displayName: "Cy", lastZone: "map1:2" },
        { displayName: "Deng", lastZone: "map1:2" },
        { displayName: null, lastZone: "map1:2" },
        { displayName: "Elsewhere", lastZone: "map1:3" },
        { displayName: "NoZone", lastZone: null },
      ],
    });
    const map1 = sections.find((s) => s.mapId === "map1")!;
    const row2 = map1.rows.find((r) => r.zoneIdx === 2)!;
    expect(row2.friendInitials).toEqual(["A", "B", "C"]);
    expect(row2.friendOverflowCount).toBe(2); // Deng + the null-name friend
    const row3 = map1.rows.find((r) => r.zoneIdx === 3)!;
    expect(row3.friendInitials).toEqual(["E"]);
    expect(row3.friendOverflowCount).toBe(0);
    const row1 = map1.rows.find((r) => r.zoneIdx === 1)!;
    expect(row1.friendInitials).toEqual([]);
  });

  it("flags hasPartyMember off partyMemberNames zoneKeys", () => {
    const sections = buildWorldMapModel({
      ...baseInput(),
      partyMemberNames: [
        { displayName: "Friend1", zoneKey: "map1:3" },
        { displayName: "NoZoneYet", zoneKey: null },
      ],
    });
    const map1 = sections.find((s) => s.mapId === "map1")!;
    expect(map1.rows.find((r) => r.zoneIdx === 3)!.hasPartyMember).toBe(true);
    expect(map1.rows.find((r) => r.zoneIdx === 1)!.hasPartyMember).toBe(false);
  });

  it("badges the asura hot zone only on the asura map's matching farm zoneIdx", () => {
    const sections = buildWorldMapModel({
      ...baseInput(),
      unlockedZones: { map1: 6, [ASURA_MAP_ID]: 10 },
      hotZoneIdx: 2,
    });
    const asura = sections.find((s) => s.mapId === ASURA_MAP_ID)!;
    expect(asura.rows.find((r) => r.zoneIdx === 2)!.isHot).toBe(true);
    expect(asura.rows.find((r) => r.zoneIdx === 0)!.isHot).toBe(false);
    // map1 never gets the hot badge even at the same zoneIdx.
    const map1 = sections.find((s) => s.mapId === "map1")!;
    expect(map1.rows.find((r) => r.zoneIdx === 2)!.isHot).toBe(false);
  });

  it("marks hasBossWindow on exactly the boss window's map section", () => {
    const sections = buildWorldMapModel({ ...baseInput(), bossWindowMapId: "map1" });
    expect(sections.find((s) => s.mapId === "map1")!.hasBossWindow).toBe(true);
    expect(sections.find((s) => s.mapId === "map2")!.hasBossWindow).toBe(false);
  });

  it("hasBossWindow is false everywhere when bossWindowMapId is null", () => {
    const sections = buildWorldMapModel({ ...baseInput(), bossWindowMapId: null });
    expect(sections.every((s) => !s.hasBossWindow)).toBe(true);
  });

  it("resolves town vs farm label pieces", () => {
    const sections = buildWorldMapModel(baseInput());
    const map1 = sections.find((s) => s.mapId === "map1")!;
    expect(map1.rows.find((r) => r.zoneIdx === 0)!.label).toEqual({ kind: "town" });
    expect(map1.rows.find((r) => r.zoneIdx === 1)!.label).toEqual({ kind: "farm", stage: 1 });
  });
});

describe("zoneKeyOf", () => {
  it("formats mapId:zoneIdx", () => {
    expect(zoneKeyOf({ mapId: "map1", zoneIdx: 3 })).toBe("map1:3");
  });
});

describe("sumCounts", () => {
  it("returns null when counts is null", () => {
    expect(sumCounts(["map1:0", "map1:1"], null)).toBeNull();
  });

  it("sums present keys and treats missing keys as 0", () => {
    expect(sumCounts(["map1:0", "map1:1", "map1:2"], { "map1:0": 2, "map1:1": 3 })).toBe(5);
  });

  it("degrades an all-zero sum to null", () => {
    expect(sumCounts(["map1:0", "map1:1"], { "map1:2": 9 })).toBeNull();
  });
});
