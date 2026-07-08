import { describe, expect, it } from "vitest";
import {
  applyProgressSlice,
  liveZoneKills,
  progressSliceFrom,
  settleProgressSlice,
  type ProgressSlice,
} from "../cohortProgress";
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

describe("liveZoneKills (owner bug batch B — fold the in-progress current-zone counter)", () => {
  it("folds the live farm-zone `kills` into the persisted zoneKills map", () => {
    const s = initGameState(1);
    s.location = { mapId: "map1", zoneIdx: 2 };
    s.zoneKills = { "map1:1": 40, "map1:2": 5 }; // stashed value for the current zone is stale
    s.kills = 12; // live counter has advanced past the stashed 5
    expect(liveZoneKills(s)).toEqual({ "map1:1": 40, "map1:2": 12 });
  });

  it("never lowers a stashed value (max), and never touches OTHER zones", () => {
    const s = initGameState(1);
    s.location = { mapId: "map1", zoneIdx: 2 };
    s.zoneKills = { "map1:2": 20 };
    s.kills = 3; // below the stashed 20 (e.g. a boss/town where kills is unrelated)
    expect(liveZoneKills(s)).toEqual({ "map1:2": 20 });
  });

  it("never mutates the source state", () => {
    const s = initGameState(1);
    s.location = { mapId: "map1", zoneIdx: 2 };
    s.zoneKills = { "map1:2": 5 };
    s.kills = 9;
    const out = liveZoneKills(s);
    out["map1:2"] = 999;
    expect(s.zoneKills["map1:2"]).toBe(5);
  });
});

describe("settleProgressSlice (owner bug batch B — FULL-credit zone-unlock accrual)", () => {
  const base = (zoneKills: Record<string, number>): ProgressSlice => ({
    ...progressSliceFrom(initGameState(1)),
    zoneKills,
  });

  it("credits the FULL shared-pot delta per person (never divided)", () => {
    // I joined with 10 kills; the shared pot went 30 -> 100 while I was in the cohort.
    const out = settleProgressSlice(base({ "map1:2": 10 }), { "map1:2": 30 }, { "map1:2": 100 });
    expect(out.zoneKills["map1:2"]).toBe(80); // 10 + (100 - 30), full credit
  });

  it("floors the delta at 0 (a pot regression / re-seed never subtracts)", () => {
    const out = settleProgressSlice(base({ "map1:2": 10 }), { "map1:2": 50 }, { "map1:2": 20 });
    expect(out.zoneKills["map1:2"]).toBe(10); // 10 + max(0, 20 - 50)
  });

  it("folds over the UNION of every key across base / sharedBase / sharedNow", () => {
    const out = settleProgressSlice(
      base({ "map1:1": 5 }),
      { "map1:2": 0 },
      { "map1:2": 7, "map1:3": 12 },
    );
    expect(out.zoneKills).toEqual({ "map1:1": 5, "map1:2": 7, "map1:3": 12 });
  });

  it("leaves every OTHER progress field frozen (unlockedZones/stage/... unchanged)", () => {
    const b = base({ "map1:2": 10 });
    b.unlockedZones = { map1: 3 };
    b.stage = 3;
    const out = settleProgressSlice(b, { "map1:2": 30 }, { "map1:2": 100 });
    expect(out.unlockedZones).toEqual({ map1: 3 });
    expect(out.stage).toBe(3);
  });

  it("re-seed no-double-count: settling then re-basing on the settled value credits each delta once", () => {
    // Cohort A: joined at pot=30, base=10; farmed to pot=100 -> settled 80.
    const settledA = settleProgressSlice(base({ "map1:2": 10 }), { "map1:2": 30 }, { "map1:2": 100 });
    expect(settledA.zoneKills["map1:2"]).toBe(80);
    // Re-seed into cohort B: the settled slice becomes the new base; new pot baseline = 100
    // (liveZoneKills of the freshly-built cohort). Farm on to pot=140.
    const settledB = settleProgressSlice(settledA, { "map1:2": 100 }, { "map1:2": 140 });
    // 80 + (140 - 100) = 120 — the 30->100 stretch is NOT counted twice.
    expect(settledB.zoneKills["map1:2"]).toBe(120);
  });

  it("never mutates its inputs", () => {
    const b = base({ "map1:2": 10 });
    const bCopy = structuredClone(b);
    const sharedBase = { "map1:2": 30 };
    const sharedNow = { "map1:2": 100 };
    settleProgressSlice(b, sharedBase, sharedNow);
    expect(b).toEqual(bCopy);
    expect(sharedBase).toEqual({ "map1:2": 30 });
    expect(sharedNow).toEqual({ "map1:2": 100 });
  });
});
