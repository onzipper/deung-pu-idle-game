import { describe, expect, it } from "vitest";
import {
  applyProgressSlice,
  deriveUnlockedZones,
  liveZoneKills,
  progressSliceFrom,
  settleProgressSlice,
  sharedProgressFrom,
  type ProgressSlice,
  type SharedProgress,
} from "../cohortProgress";
import { CONFIG, initGameState, TOME_ALL_PAGES, zoneAt, type GameState } from "@/engine";

/** Build a `SharedProgress` with zeroed asura defaults (the common case in the
 * zone-kill-centric tests). */
function sp(
  zoneKills: Record<string, number>,
  extra?: Partial<Omit<SharedProgress, "zoneKills">>,
): SharedProgress {
  return { zoneKills, asuraEssence: 0, asuraZoneKills: {}, tomePages: 0, ...extra };
}

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
    const out = settleProgressSlice(base({ "map1:2": 10 }), sp({ "map1:2": 30 }), sp({ "map1:2": 100 }), 3, 0);
    expect(out.zoneKills["map1:2"]).toBe(80); // 10 + (100 - 30), full credit (size 3 irrelevant)
  });

  it("floors the delta at 0 (a pot regression / re-seed never subtracts)", () => {
    const out = settleProgressSlice(base({ "map1:2": 10 }), sp({ "map1:2": 50 }), sp({ "map1:2": 20 }), 1, 0);
    expect(out.zoneKills["map1:2"]).toBe(10); // 10 + max(0, 20 - 50)
  });

  it("folds over the UNION of every key across base / sharedBase / sharedNow", () => {
    const out = settleProgressSlice(
      base({ "map1:1": 5 }),
      sp({ "map1:2": 0 }),
      sp({ "map1:2": 7, "map1:3": 12 }),
      1,
      0,
    );
    expect(out.zoneKills).toEqual({ "map1:1": 5, "map1:2": 7, "map1:3": 12 });
  });

  it("leaves every OTHER progress field frozen (unlockedZones/stage/... unchanged)", () => {
    const b = base({ "map1:2": 10 });
    b.unlockedZones = { map1: 3 };
    b.stage = 3;
    const out = settleProgressSlice(b, sp({ "map1:2": 30 }), sp({ "map1:2": 100 }), 1, 0);
    expect(out.unlockedZones).toEqual({ map1: 3 });
    expect(out.stage).toBe(3);
  });

  it("re-seed no-double-count: settling then re-basing on the settled value credits each delta once", () => {
    // Cohort A: joined at pot=30, base=10; farmed to pot=100 -> settled 80.
    const settledA = settleProgressSlice(base({ "map1:2": 10 }), sp({ "map1:2": 30 }), sp({ "map1:2": 100 }), 1, 0);
    expect(settledA.zoneKills["map1:2"]).toBe(80);
    // Re-seed into cohort B: the settled slice becomes the new base; new pot baseline = 100
    // (liveZoneKills of the freshly-built cohort). Farm on to pot=140.
    const settledB = settleProgressSlice(settledA, sp({ "map1:2": 100 }), sp({ "map1:2": 140 }), 1, 0);
    // 80 + (140 - 100) = 120 — the 30->100 stretch is NOT counted twice.
    expect(settledB.zoneKills["map1:2"]).toBe(120);
  });

  it("never mutates its inputs", () => {
    const b = base({ "map1:2": 10 });
    const bCopy = structuredClone(b);
    const sharedBase = sp({ "map1:2": 30 });
    const sharedNow = sp({ "map1:2": 100 });
    const sbCopy = structuredClone(sharedBase);
    const snCopy = structuredClone(sharedNow);
    settleProgressSlice(b, sharedBase, sharedNow, 2, 1);
    expect(b).toEqual(bCopy);
    expect(sharedBase).toEqual(sbCopy);
    expect(sharedNow).toEqual(snCopy);
  });
});

describe("settleProgressSlice (2026-07-09 asura per-member accounting)", () => {
  const base = (extra?: Partial<ProgressSlice>): ProgressSlice => ({
    ...progressSliceFrom(initGameState(1)),
    ...extra,
  });

  it("asuraEssence = EQUAL MEAN-FIELD split (base + trunc(drift/size)), like the wallet", () => {
    // base 5; shared pot 0 -> 100 while in a 3-person cohort -> 5 + trunc(100/3) = 5 + 33.
    const out = settleProgressSlice(
      base({ asuraEssence: 5 }),
      sp({}, { asuraEssence: 0 }),
      sp({}, { asuraEssence: 100 }),
      3,
      0,
    );
    expect(out.asuraEssence).toBe(38);
  });

  it("asuraEssence split floors negative drift at 0 (a big shared SPEND never underflows me)", () => {
    // base 2; pot 90 -> 30 (a 60 spend), size 2 -> 2 + trunc(-60/2) = 2 - 30 -> max(0, -28).
    const out = settleProgressSlice(
      base({ asuraEssence: 2 }),
      sp({}, { asuraEssence: 90 }),
      sp({}, { asuraEssence: 30 }),
      2,
      0,
    );
    expect(out.asuraEssence).toBe(0);
  });

  it("asuraEssence split at size 1 credits the full drift (solo-in-party degenerate case)", () => {
    const out = settleProgressSlice(
      base({ asuraEssence: 10 }),
      sp({}, { asuraEssence: 4 }),
      sp({}, { asuraEssence: 24 }),
      1,
      0,
    );
    expect(out.asuraEssence).toBe(30); // 10 + (24 - 4)
  });

  it("asuraZoneKills = FULL credit per key over the union (mirrors zoneKills gate logic)", () => {
    const out = settleProgressSlice(
      base({ asuraZoneKills: { "asura:3": 20 } }),
      sp({}, { asuraZoneKills: { "asura:3": 5 } }),
      sp({}, { asuraZoneKills: { "asura:3": 55, "asura:4": 8 } }),
      4,
      0,
    );
    // asura:3 -> 20 + (55 - 5) = 70 (size 4 ignored); asura:4 -> 0 + 8.
    expect(out.asuraZoneKills).toEqual({ "asura:3": 70, "asura:4": 8 });
  });

  it("tomePages = bitmask OR of my base and the shared pot's found pages", () => {
    const out = settleProgressSlice(
      base({ tomePages: 0b001 }),
      sp({}, { tomePages: 0 }),
      sp({}, { tomePages: 0b010 }),
      2,
      0,
    );
    expect(out.tomePages).toBe(0b011);
  });

  it("tomeUnlocked LATCHES once the settled pages are complete (TOME_ALL_PAGES)", () => {
    // base has 2 of 3 pages + not unlocked; the pot supplies the last -> unlock latches.
    const missingOne = TOME_ALL_PAGES & ~1; // drop the lowest bit
    const out = settleProgressSlice(
      base({ tomePages: missingOne, tomeUnlocked: false }),
      sp({}, { tomePages: 0 }),
      sp({}, { tomePages: 1 }),
      2,
      0,
    );
    expect(out.tomePages).toBe(TOME_ALL_PAGES);
    expect(out.tomeUnlocked).toBe(true);
  });

  it("tomeUnlocked stays true if my base already had it (never un-latches on an incomplete pot)", () => {
    const out = settleProgressSlice(
      base({ tomePages: 0, tomeUnlocked: true }),
      sp({}, { tomePages: 0 }),
      sp({}, { tomePages: 0 }),
      2,
      0,
    );
    expect(out.tomeUnlocked).toBe(true);
  });

  it("asuraSigils = base + claims*perClaim (NOT a drift split — server-ledgered once/day)", () => {
    const per = CONFIG.asura.tome.sigilPerClaim;
    const out = settleProgressSlice(base({ asuraSigils: 4 }), sp({}), sp({}), 3, 2);
    expect(out.asuraSigils).toBe(4 + 2 * per);
  });

  it("re-seed no-double-count across ALL new fields (essence/asuraZK/tomePages/sigils)", () => {
    // Cohort A (size 2): essence base 10, pot 0->40 -> 10+20=30; asuraZK 0 -> +12=12;
    // pages 0 | 0b010; 1 sigil claim -> 5+1.
    const per = CONFIG.asura.tome.sigilPerClaim;
    const settledA = settleProgressSlice(
      base({ asuraEssence: 10, asuraZoneKills: {}, tomePages: 0, asuraSigils: 5 }),
      sp({ "map1:2": 0 }, { asuraEssence: 0, asuraZoneKills: {}, tomePages: 0 }),
      sp({ "map1:2": 12 }, { asuraEssence: 40, asuraZoneKills: { "asura:0": 12 }, tomePages: 0b010 }),
      2,
      1,
    );
    expect(settledA.asuraEssence).toBe(30);
    expect(settledA.asuraZoneKills).toEqual({ "asura:0": 12 });
    expect(settledA.tomePages).toBe(0b010);
    expect(settledA.asuraSigils).toBe(5 + per);
    // Re-seed into cohort B (settled A is the new base; pot re-baselines at the built cohort's
    // values — asura resets to 0 on rebuild, zoneKills carries the authority's). Farm on.
    const settledB = settleProgressSlice(
      settledA,
      sp({ "map1:2": 12 }, { asuraEssence: 0, asuraZoneKills: {}, tomePages: 0 }),
      sp({ "map1:2": 20 }, { asuraEssence: 20, asuraZoneKills: { "asura:0": 4 }, tomePages: 0b001 }),
      2,
      0,
    );
    expect(settledB.asuraEssence).toBe(40); // 30 + trunc(20/2), the A stretch NOT re-counted
    expect(settledB.asuraZoneKills).toEqual({ "asura:0": 16 }); // 12 + 4
    expect(settledB.tomePages).toBe(0b011); // OR accumulates
    expect(settledB.asuraSigils).toBe(5 + per); // no new claims in B -> unchanged
  });
});

describe("sharedProgressFrom", () => {
  it("captures zoneKills (with the live current-zone fold) + asura essence/zone-kills/tome pages", () => {
    const s = initGameState(1);
    s.location = { mapId: "map1", zoneIdx: 2 };
    s.zoneKills = { "map1:2": 5 };
    s.kills = 9; // live counter ahead of the stashed value
    s.asuraEssence = 42;
    s.asuraZoneKills = { "asura:3": 8 };
    s.tomePages = 0b101;
    const out = sharedProgressFrom(s);
    expect(out.zoneKills).toEqual({ "map1:2": 9 }); // folded via liveZoneKills
    expect(out.asuraEssence).toBe(42);
    expect(out.asuraZoneKills).toEqual({ "asura:3": 8 });
    expect(out.tomePages).toBe(0b101);
  });

  it("deep-copies the asura record (never aliases live state)", () => {
    const s = initGameState(1);
    s.asuraZoneKills = { "asura:0": 3 };
    const out = sharedProgressFrom(s);
    out.asuraZoneKills["asura:0"] = 999;
    expect(s.asuraZoneKills["asura:0"]).toBe(3);
  });
});

describe("deriveUnlockedZones (FIX 4 — per-member unlock display, mirrors checkZoneUnlock)", () => {
  const slice = (unlockedZones: Record<string, number>, zoneKills: Record<string, number>): ProgressSlice => ({
    ...progressSliceFrom(initGameState(1)),
    unlockedZones,
    zoneKills,
  });
  // The first two FARM zones of map1 (town is zoneIdx 0), and their kill goals.
  const goalAt = (mapId: string, idx: number): number => CONFIG.killGoal(zoneAt({ mapId, zoneIdx: idx }).stage);

  it("cascades one farm zone forward when the frontier's kills meet killGoal", () => {
    // map1 count 2 (town + farm idx1 unlocked); farm idx1 quota met, idx2 empty.
    const out = deriveUnlockedZones(slice({ map1: 2 }, { "map1:1": goalAt("map1", 1) }));
    expect(out.map1).toBe(3); // idx2 now unlocked
  });

  it("cascades multiple zones when several frontiers are complete", () => {
    const out = deriveUnlockedZones(
      slice({ map1: 2 }, { "map1:1": goalAt("map1", 1), "map1:2": goalAt("map1", 2) }),
    );
    expect(out.map1).toBe(4); // idx1 -> idx2 -> idx3
  });

  it("does NOT overshoot: stops at the first frontier below quota", () => {
    const out = deriveUnlockedZones(
      slice({ map1: 2 }, { "map1:1": goalAt("map1", 1), "map1:2": goalAt("map1", 2) - 1 }),
    );
    expect(out.map1).toBe(3); // idx2 unlocked, but its (short) quota blocks idx3
  });

  it("boss-gate conservatism: unlocks the boss ROOM but NEVER derive-unlocks the next map", () => {
    // Unlock all of map1's farm zones, meeting every quota; only the boss room should open,
    // and map2 must stay untouched (that needs a boss KILL, not purely derivable).
    const farmCount = zoneAt({ mapId: "map1", zoneIdx: 0 }); // ensure map1 resolves
    expect(farmCount.mapId).toBe("map1");
    // Find map1's farm zones by walking indices until a non-farm zone.
    const zk: Record<string, number> = {};
    let idx = 1;
    while (zoneAt({ mapId: "map1", zoneIdx: idx }).kind === "farm") {
      zk[`map1:${idx}`] = goalAt("map1", idx);
      idx++;
    }
    const bossIdx = idx; // the boss room sits right after the last farm
    const out = deriveUnlockedZones(slice({ map1: 2 }, zk));
    expect(out.map1).toBe(bossIdx + 1); // boss room unlocked (count incl. boss idx)
    expect(out.map2).toBeUndefined(); // next map NEVER derive-unlocked
  });

  it("a town/non-farm frontier stops the cascade (count 1 = only the town unlocked)", () => {
    const out = deriveUnlockedZones(slice({ map1: 1 }, { "map1:1": 99999 }));
    expect(out.map1).toBe(1); // town frontier never cascades
  });

  it("the quest-preview conservatism: a not-persist-unlocked map (count 0) never cascades", () => {
    // map4 preview zone kills exist but map4 has count 0 (not persist-unlocked) -> no unlock.
    const out = deriveUnlockedZones(slice({ map1: 2, map4: 0 }, { "map4:1": 99999, "map1:1": 0 }));
    expect(out.map4).toBe(0);
    expect(out.map1).toBe(2);
  });

  it("is idempotent (a fixed point — re-deriving the result changes nothing)", () => {
    const once = deriveUnlockedZones(slice({ map1: 2 }, { "map1:1": goalAt("map1", 1) }));
    const twice = deriveUnlockedZones({ ...progressSliceFrom(initGameState(1)), unlockedZones: once, zoneKills: { "map1:1": goalAt("map1", 1) } });
    expect(twice).toEqual(once);
  });

  it("never mutates its input slice", () => {
    const s = slice({ map1: 2 }, { "map1:1": goalAt("map1", 1) });
    const copy = structuredClone(s);
    deriveUnlockedZones(s);
    expect(s).toEqual(copy);
  });
});
