import { describe, expect, it } from "vitest";
import { applyProgressSlice, progressSliceFrom, type ProgressSlice } from "../cohortProgress";
import { initGameState, type GameState } from "@/engine";

function deepFriendState(): GameState {
  // A "deep player" shape: far world progress across every field the leak covered.
  const s: GameState = initGameState(1);
  s.stage = 36;
  s.location = { mapId: "map6", zoneIdx: 9 };
  s.unlockedZones = { map1: 5, map2: 5, map3: 5, map4: 5, map5: 5, map6: 10 };
  s.lastFarmZone = { mapId: "map6", zoneIdx: 8 };
  s.zoneKills = { "map6:9": 42, "map1:0": 100 };
  s.kills = 42;
  s.bossBest = { 30: { seconds: 12, at: 1000 } };
  s.levelCapAt = 555;
  s.asuraEssence = 900;
  s.asuraZoneKills = { "asura:3": 80 };
  s.asuraSigils = 12;
  s.tomePages = 7;
  s.tomeUnlocked = true;
  return s;
}

function freshAccountState(): GameState {
  const s: GameState = initGameState(2);
  s.stage = 1;
  s.location = { mapId: "map1", zoneIdx: 0 };
  s.unlockedZones = { map1: 1 };
  s.lastFarmZone = { mapId: "map1", zoneIdx: 0 };
  s.zoneKills = { "map1:0": 3 };
  s.kills = 3;
  s.bossBest = {};
  s.levelCapAt = null;
  s.asuraEssence = 0;
  s.asuraZoneKills = {};
  s.asuraSigils = 0;
  s.tomePages = 0;
  s.tomeUnlocked = false;
  return s;
}

describe("progressSliceFrom", () => {
  it("deep-copies every world-progression field (no aliasing of live state)", () => {
    const s = deepFriendState();
    const slice = progressSliceFrom(s);
    expect(slice.location).toEqual(s.location);
    expect(slice.unlockedZones).toEqual(s.unlockedZones);
    expect(slice.zoneKills).toEqual(s.zoneKills);
    expect(slice.bossBest).toEqual(s.bossBest);
    expect(slice.asuraZoneKills).toEqual(s.asuraZoneKills);

    slice.unlockedZones.map6 = 0;
    slice.zoneKills["map6:9"] = 0;
    slice.bossBest[30] = { seconds: 0, at: 0 };
    slice.asuraZoneKills["asura:3"] = 0;
    expect(s.unlockedZones.map6).toBe(10); // clone, not alias
    expect(s.zoneKills["map6:9"]).toBe(42);
    expect(s.bossBest[30]).toEqual({ seconds: 12, at: 1000 });
    expect(s.asuraZoneKills["asura:3"]).toBe(80);
  });
});

describe("applyProgressSlice", () => {
  it("the owner live bug: a fresh account's save-view never adopts a deep friend's world unlocks", () => {
    // Simulate: fresh account joins a cohort whose LIVE (shared) state is the deep
    // friend's — this is what `serialize()`/`extractSoloState` used to persist verbatim.
    const freshBase: ProgressSlice = progressSliceFrom(freshAccountState());
    const leakedLiveView = deepFriendState(); // stand-in for a save-view built off the shared state

    applyProgressSlice(leakedLiveView, freshBase);

    expect(leakedLiveView.stage).toBe(1);
    expect(leakedLiveView.location).toEqual({ mapId: "map1", zoneIdx: 0 });
    expect(leakedLiveView.unlockedZones).toEqual({ map1: 1 }); // NOT map6:10
    expect(leakedLiveView.lastFarmZone).toEqual({ mapId: "map1", zoneIdx: 0 });
    expect(leakedLiveView.zoneKills).toEqual({ "map1:0": 3 });
    expect(leakedLiveView.bossBest).toEqual({});
    expect(leakedLiveView.levelCapAt).toBeNull();
    expect(leakedLiveView.asuraEssence).toBe(0);
    expect(leakedLiveView.asuraZoneKills).toEqual({});
    expect(leakedLiveView.asuraSigils).toBe(0);
    expect(leakedLiveView.tomePages).toBe(0);
    expect(leakedLiveView.tomeUnlocked).toBe(false);
  });

  it("recomputes `kills` from the restored zoneKills/location pair, not the live value", () => {
    const target = deepFriendState(); // target.kills currently 42 (map6:9)
    const slice = progressSliceFrom(freshAccountState()); // map1:0 -> 3
    applyProgressSlice(target, slice);
    expect(target.kills).toBe(3);
  });

  it("a location/zoneKills pair with no matching key restores kills to 0", () => {
    const target = deepFriendState();
    const slice: ProgressSlice = {
      ...progressSliceFrom(freshAccountState()),
      location: { mapId: "map2", zoneIdx: 5 }, // no "map2:5" entry in zoneKills
      zoneKills: { "map1:0": 3 },
    };
    applyProgressSlice(target, slice);
    expect(target.kills).toBe(0);
  });

  it("never mutates the slice passed in", () => {
    const slice = progressSliceFrom(deepFriendState());
    const sliceCopy = structuredClone(slice);
    const target = freshAccountState();
    applyProgressSlice(target, slice);
    expect(slice).toEqual(sliceCopy);
  });

  it("clones nested objects onto the target (no aliasing back to the slice)", () => {
    const slice = progressSliceFrom(deepFriendState());
    const target = freshAccountState();
    applyProgressSlice(target, slice);
    target.unlockedZones.map6 = 999;
    target.bossBest[30] = { seconds: 0, at: 0 };
    expect(slice.unlockedZones.map6).toBe(10);
    expect(slice.bossBest[30]).toEqual({ seconds: 12, at: 1000 });
  });
});
