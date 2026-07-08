import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  initGameState,
  migrate,
  step,
  toSaveData,
  mainQuestChapters,
  isMainChapterComplete,
  completedChapterIds,
  dailyDef,
  isDailyComplete,
} from "@/engine";
import type { GameState, WorldLocation } from "@/engine";
import { soloSave, forceBoss, makeStubEnemy } from "./helpers";

/**
 * M8 Wave A — quest system (main line + dailies) + "วาปหาเพื่อน" warp scroll (SAVE v17).
 * All new engine paths are INERT until a roster/claim/scroll exists, so the balance sim
 * (which fires none of them) is byte-identical — the "sim-inert" block below asserts it.
 */

/** A solo state with a settable location + full unlock so warp targets exist. */
function freshState(stage = 3): GameState {
  return initGameState(1, soloSave("swordsman", stage));
}

// ---------------------------------------------------------------------------
// MAIN quest — derive / claim / no-double-claim
// ---------------------------------------------------------------------------

describe("M8 main quest — chapter derivation", () => {
  it("a chapter is complete once its map's boss is beaten (next map unlocked)", () => {
    const s = freshState(3);
    // Fresh at map1 (only map1 unlocked) — no chapter complete yet.
    expect(isMainChapterComplete("map1", s.unlockedZones, s.bossBest)).toBe(false);
    // Simulate beating map1's boss: map2 zone 1 becomes persist-unlocked.
    s.unlockedZones.map2 = 1;
    expect(isMainChapterComplete("map1", s.unlockedZones, s.bossBest)).toBe(true);
    expect(isMainChapterComplete("map2", s.unlockedZones, s.bossBest)).toBe(false);
  });

  it("the FINAL map's chapter keys off bossBest (no next map to unlock)", () => {
    const s = freshState(3);
    expect(isMainChapterComplete("map6", s.unlockedZones, s.bossBest)).toBe(false);
    s.bossBest[30] = { seconds: 42, at: 0 };
    expect(isMainChapterComplete("map6", s.unlockedZones, s.bossBest)).toBe(true);
  });

  it("mainQuestChapters reflects complete/claimed/claimable per chapter", () => {
    const s = freshState(3);
    s.unlockedZones.map2 = 1; // chapter_map1 complete, unclaimed
    const before = mainQuestChapters(s).find((c) => c.id === "chapter_map1")!;
    expect(before).toMatchObject({ complete: true, claimed: false, claimable: true });
  });
});

describe("M8 main quest — claim", () => {
  it("claims a completed chapter's reward once, then never again", () => {
    const s = freshState(3);
    s.unlockedZones.map2 = 1; // chapter_map1 complete
    const gold0 = s.gold;
    const mats0 = s.materials;
    const reward = CONFIG.mainQuest.chapters.find((c) => c.id === "chapter_map1")!.reward;

    step(s, { claimMainReward: "chapter_map1" });
    expect(s.heroes[0].mainClaimed).toContain("chapter_map1");
    expect(s.gold).toBe(gold0 + (reward.gold ?? 0));
    expect(s.materials).toBe(mats0 + (reward.materials ?? 0));
    const evt = s.events.find((e) => e.type === "questReward");
    expect(evt).toMatchObject({ type: "questReward", source: "main", questId: "chapter_map1" });

    // Double-claim is a no-op (no further gold/materials, no new event).
    const goldAfter = s.gold;
    step(s, { claimMainReward: "chapter_map1" });
    expect(s.gold).toBe(goldAfter);
    expect(s.events.some((e) => e.type === "questReward")).toBe(false);
  });

  it("cannot claim an INCOMPLETE chapter", () => {
    const s = freshState(3);
    const gold0 = s.gold;
    step(s, { claimMainReward: "chapter_map2" }); // map2 boss not beaten
    expect(s.heroes[0].mainClaimed).not.toContain("chapter_map2");
    expect(s.gold).toBe(gold0);
  });
});

// ---------------------------------------------------------------------------
// DAILY quests — count-at-choke-points / claim / roster replace
// ---------------------------------------------------------------------------

/** Install a roster of `ids` for day `day` on the solo hero via the real intent. */
function setDailies(s: GameState, ids: string[], day = 1): void {
  step(s, { setDailies: { serverDay: day, questIds: ids } });
}

function daily(s: GameState, id: string) {
  return s.heroes[0].dailies.quests.find((q) => q.id === id);
}

describe("M8 daily quests — counting at the emission choke points", () => {
  it("killAnywhere counts a real mob kill", () => {
    const s = freshState(3);
    setDailies(s, ["daily_kill"]);
    s.spawnPaused = true;
    s.enemies = [makeStubEnemy(s.nextId++, s.heroes[0].x + 20, 1)];
    // Step until the hero hunts + kills the stub.
    for (let i = 0; i < 120 && s.enemies.length > 0; i++) step(s);
    expect(s.enemies.length).toBe(0);
    expect(daily(s, "daily_kill")!.progress).toBe(1);
  });

  it("buyPotions + spendGold count a town potion purchase", () => {
    const s = freshState(3);
    s.location = { mapId: "map1", zoneIdx: 0 }; // town
    s.gold = 100_000;
    setDailies(s, ["daily_potions", "daily_spend"]);
    step(s, { buyShopItem: { item: "hpPotion", qty: 4 } });
    expect(daily(s, "daily_potions")!.progress).toBe(4);
    expect(daily(s, "daily_spend")!.progress).toBeGreaterThan(0);
  });

  it("buyPotions does NOT count a scroll purchase (only potions)", () => {
    const s = freshState(3);
    s.location = { mapId: "map1", zoneIdx: 0 };
    s.gold = 100_000;
    setDailies(s, ["daily_potions"]);
    step(s, { buyShopItem: { item: "warpScroll", qty: 2 } });
    expect(daily(s, "daily_potions")!.progress).toBe(0);
  });

  it("refineOnce counts a server-confirmed refine (the `refined` intent)", () => {
    const s = freshState(3);
    setDailies(s, ["daily_refine"]);
    step(s, { refined: true });
    expect(daily(s, "daily_refine")!.progress).toBe(1);
    expect(isDailyComplete(daily(s, "daily_refine")!)).toBe(true);
  });

  it("spendGold counts a negative goldCredit (a refine cost)", () => {
    const s = freshState(3);
    s.gold = 5_000;
    setDailies(s, ["daily_spend"]);
    step(s, { goldCredit: -800 });
    expect(daily(s, "daily_spend")!.progress).toBe(800);
  });

  it("clearAnyBoss counts a boss defeat", () => {
    const s = freshState(3);
    setDailies(s, ["daily_boss"]);
    forceBoss(s);
    s.boss!.hp = 0; // resolveDeaths -> onBossKilled this step
    step(s);
    expect(daily(s, "daily_boss")!.progress).toBe(1);
  });

  it("emits dailyProgress ONLY on the complete transition (throttled)", () => {
    const s = freshState(3);
    setDailies(s, ["daily_spend"]); // target 2500
    step(s, { goldCredit: -1000 }); // 1000 < target — no event
    expect(s.events.some((e) => e.type === "dailyProgress")).toBe(false);
    s.gold = 100_000;
    step(s, { goldCredit: -2000 }); // crosses target — one complete event
    const evt = s.events.find((e) => e.type === "dailyProgress");
    expect(evt).toMatchObject({ type: "dailyProgress", questId: "daily_spend", complete: true });
  });
});

describe("M8 daily quests — claim + roster replace", () => {
  it("claims a completed daily once; a second claim is a no-op", () => {
    const s = freshState(3);
    setDailies(s, ["daily_refine"]);
    step(s, { refined: true }); // progress 1 = target
    const mats0 = s.materials;
    const reward = dailyDef("daily_refine")!.reward;

    step(s, { claimDaily: "daily_refine" });
    expect(daily(s, "daily_refine")!.claimed).toBe(true);
    expect(s.materials).toBe(mats0 + (reward.materials ?? 0));

    const matsAfter = s.materials;
    step(s, { claimDaily: "daily_refine" });
    expect(s.materials).toBe(matsAfter);
  });

  it("cannot claim an incomplete daily", () => {
    const s = freshState(3);
    setDailies(s, ["daily_kill"]); // target 120, no kills
    const gold0 = s.gold;
    step(s, { claimDaily: "daily_kill" });
    expect(daily(s, "daily_kill")!.claimed).toBe(false);
    expect(s.gold).toBe(gold0);
  });

  it("a NEW serverDay resets the roster (fresh progress/claims); same day preserves", () => {
    const s = freshState(3);
    setDailies(s, ["daily_refine"], 1);
    step(s, { refined: true });
    expect(daily(s, "daily_refine")!.progress).toBe(1);

    // Same day re-feed keeps progress (idempotent boot re-feed).
    setDailies(s, ["daily_refine"], 1);
    expect(daily(s, "daily_refine")!.progress).toBe(1);

    // New day resets and swaps the roster.
    setDailies(s, ["daily_kill"], 2);
    expect(s.heroes[0].dailies.serverDay).toBe(2);
    expect(daily(s, "daily_refine")).toBeUndefined();
    expect(daily(s, "daily_kill")!.progress).toBe(0);
  });

  it("drops unknown ids and clamps the roster to rosterSize", () => {
    const s = freshState(3);
    setDailies(s, ["daily_kill", "nope_unknown", "daily_refine", "daily_potions", "daily_spend"]);
    const ids = s.heroes[0].dailies.quests.map((q) => q.id);
    expect(ids).not.toContain("nope_unknown");
    expect(ids.length).toBe(CONFIG.dailyQuests.rosterSize);
  });
});

// ---------------------------------------------------------------------------
// MIGRATION v16 -> v17
// ---------------------------------------------------------------------------

describe("M8 SAVE v17 migration", () => {
  it("bumps to 17, backfills warpScroll=0 + empty dailies for a pre-v17 save", () => {
    const m = migrate({ version: 16, stage: 3, gold: 100, hero: { cls: "mage", level: 20, tier: 1 } });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.consumables.warpScroll).toBe(0);
    expect(m.hero.dailies).toEqual({ serverDay: 0, quests: [] });
  });

  it("prefills mainClaimed with ALREADY-COMPLETED chapters — NO backpay", () => {
    // A deep v16 save: map3 unlocked => map1 + map2 bosses beaten already.
    const gold = 50_000;
    const m = migrate({
      version: 16,
      stage: 12,
      gold,
      unlockedZones: { map1: 7, map2: 6, map3: 3 },
      hero: { cls: "swordsman", level: 45, tier: 3 },
    });
    // chapter_map1 + chapter_map2 are complete (map2/map3 unlocked) -> marked claimed.
    expect(m.hero.mainClaimed).toEqual(["chapter_map1", "chapter_map2"]);
    // NO reward was granted retroactively (mirrors v16 goldEarned=0 discipline).
    expect(m.gold).toBe(gold);
  });

  it("round-trips a v17 save (idempotent) preserving claim log + daily roster", () => {
    const built = migrate({
      version: 16,
      stage: 6,
      gold: 1000,
      unlockedZones: { map1: 7, map2: 1 },
      hero: { cls: "archer", level: 30, tier: 2 },
    });
    // Seed a live daily roster + one claim, serialise, migrate again.
    const s = initGameState(7, built);
    step(s, { setDailies: { serverDay: 5, questIds: ["daily_kill"] } });
    const save = toSaveData(s);
    save.version = SAVE_VERSION;
    const again = migrate(save);
    expect(again.hero.mainClaimed).toEqual(save.hero.mainClaimed);
    expect(again.hero.dailies).toEqual(save.hero.dailies);
    // A second migrate is byte-identical (migrate-on-every-save).
    expect(migrate(again)).toEqual(again);
  });

  it("completedChapterIds is a pure derivation of the two records", () => {
    expect(completedChapterIds({ map1: 7 }, {})).toEqual([]); // map2 not unlocked
    expect(completedChapterIds({ map1: 7, map2: 1 }, {})).toEqual(["chapter_map1"]);
  });
});

// ---------------------------------------------------------------------------
// WARP SCROLL "วาปหาเพื่อน"
// ---------------------------------------------------------------------------

describe("M8 warp scroll — validations", () => {
  const target: WorldLocation = { mapId: "map1", zoneIdx: 1 }; // unlocked farm, not current

  it("no scroll held -> no travel, no scroll spent", () => {
    const s = freshState(3);
    expect(s.consumables.warpScroll).toBe(0);
    step(s, { useWarpScroll: target });
    expect(s.fastTravelCast).toBeNull();
    expect(s.consumables.warpScroll).toBe(0);
  });

  it("a LOCKED zone is rejected and the scroll is NOT consumed", () => {
    const s = freshState(3);
    s.consumables.warpScroll = 1;
    step(s, { useWarpScroll: { mapId: "map2", zoneIdx: 0 } }); // locked
    expect(s.fastTravelCast).toBeNull();
    expect(s.consumables.warpScroll).toBe(1);
    expect(s.events.some((e) => e.type === "fastTravelBlocked" && e.reason === "locked")).toBe(true);
  });

  it("the BOSS phase is rejected (no warp mid-boss), scroll kept", () => {
    const s = freshState(3);
    s.consumables.warpScroll = 1;
    forceBoss(s);
    step(s, { useWarpScroll: target });
    expect(s.consumables.warpScroll).toBe(1);
    expect(s.events.some((e) => e.type === "fastTravelBlocked" && e.reason === "boss")).toBe(true);
  });

  it("consumes ONE scroll and starts the fast-travel channel to an unlocked zone", () => {
    const s = freshState(3);
    s.consumables.warpScroll = 2;
    step(s, { useWarpScroll: target });
    expect(s.consumables.warpScroll).toBe(1);
    expect(s.fastTravelCast).toMatchObject({ targetMapId: "map1", targetZoneIdx: 1 });
    expect(s.events.some((e) => e.type === "consumableUsed" && e.item === "warpScroll")).toBe(true);
    expect(s.events.some((e) => e.type === "fastTravelCastStart")).toBe(true);
  });

  it("the idle BOT never consumes a warp scroll (dumb-automation law)", () => {
    const s = freshState(3);
    s.consumables.warpScroll = 5;
    s.consumables.returnScroll = 5;
    // Arm both bots aggressively so town trips fire repeatedly.
    step(s, {
      setBotSettings: { enabled: true, sellTripEnabled: true, hpPotionTarget: 99, mpPotionTarget: 99 },
    });
    s.gold = 1_000_000;
    for (let i = 0; i < 400; i++) step(s, { inventoryCount: 999 });
    expect(s.consumables.warpScroll).toBe(5); // untouched by any bot path
  });
});

// ---------------------------------------------------------------------------
// SIM-INERT proof — no roster / no scroll => new paths never move state
// ---------------------------------------------------------------------------

describe("M8 sim-inert", () => {
  it("kills/boss/refine with NO daily roster leave dailies empty + emit no quest events", () => {
    const s = freshState(3);
    s.spawnPaused = true;
    s.enemies = [makeStubEnemy(s.nextId++, s.heroes[0].x + 20, 1)];
    for (let i = 0; i < 120 && s.enemies.length > 0; i++) step(s);
    step(s, { refined: true });
    forceBoss(s);
    s.boss!.hp = 0;
    step(s);
    // No roster was ever set: nothing counts, nothing rewards.
    expect(s.heroes[0].dailies).toEqual({ serverDay: 0, quests: [] });
    expect(s.heroes[0].mainClaimed).toEqual([]);
    expect(s.events.some((e) => e.type === "dailyProgress" || e.type === "questReward")).toBe(false);
  });

  it("an unused warp scroll never perturbs an idle run (determinism replay)", () => {
    const run = (): GameState => {
      const s = freshState(3);
      s.consumables.warpScroll = 3; // held but never used
      for (let i = 0; i < 600; i++) step(s);
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
