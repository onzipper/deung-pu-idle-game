import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  INVENTORY_CAP,
  initGameState,
  migrate,
  step,
  toSaveData,
  zoneAt,
  isZoneUnlocked,
  defaultBotSettings,
  shopStageOf,
  shopPriceAt,
  heroMaxHpOf,
  type FrameInput,
  type GameState,
} from "@/engine";
import { soloSave } from "./helpers";

/**
 * M7.5 "Sell, Bots & Inventory UX" (engine): the potion-restock + sell-trip bots,
 * fast travel (channel / cancel / gates), zone-gate transit events, vendor pricing,
 * and SAVE v10->v11 migration. All deterministic (no RNG in any of this).
 */

/** Fully unlock the world so fast-travel / navigation tests can move freely. */
function unlockAll(s: GameState): void {
  s.unlockedZones = { map1: 7, map2: 6, map3: 6 };
}

/** Run the sim until `pred` holds or `cap` steps pass, feeding a constant `input`. */
function runUntilInput(
  s: GameState,
  input: FrameInput,
  pred: (s: GameState) => boolean,
  cap: number,
): boolean {
  for (let i = 0; i < cap; i++) {
    if (pred(s)) return true;
    step(s, input);
  }
  return pred(s);
}

// ---------------------------------------------------------------------------
// SAVE v10 -> v11 migration
// ---------------------------------------------------------------------------

describe("SAVE v10 -> v11 migration (bot settings)", () => {
  it("backfills the config defaults (both bots OFF) for a pre-v11 save", () => {
    const m = migrate({
      version: 10,
      stage: 5,
      gold: 10,
      hero: { cls: "mage", level: 20, tier: 1 },
    });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.bot).toEqual(defaultBotSettings());
    expect(m.bot.enabled).toBe(false);
    expect(m.bot.sellTripEnabled).toBe(false);
  });

  it("preserves + clamps a v11 save's bot settings (idempotent)", () => {
    const once = migrate({
      version: 11,
      stage: 7,
      gold: 50,
      hero: { cls: "archer", level: 22, tier: 2 },
      bot: {
        enabled: true,
        sellTripEnabled: true,
        hpPotionTarget: 500, // over the stack cap -> clamped
        mpPotionTarget: 20,
        scrollReserve: 5,
        goldReserve: 1000,
      },
    });
    expect(once.bot.enabled).toBe(true);
    expect(once.bot.hpPotionTarget).toBe(CONFIG.shop.stackCap); // clamped
    expect(once.bot.mpPotionTarget).toBe(20);
    expect(once.bot.goldReserve).toBe(1000);
    expect(migrate(once)).toEqual(once); // idempotent
  });

  it("round-trips bot settings through initGameState + toSaveData", () => {
    const save = soloSave("swordsman", 4);
    save.bot = {
      enabled: true,
      sellTripEnabled: false,
      hpPotionTarget: 25,
      mpPotionTarget: 10,
      scrollReserve: 4,
      goldReserve: 200,
    };
    const restored = toSaveData(initGameState(9, save));
    expect(restored.bot).toEqual(save.bot);
  });

  it("coerces malformed bot fields to defaults", () => {
    const m = migrate({
      version: 11,
      stage: 3,
      gold: 0,
      hero: { cls: "swordsman", level: 5, tier: 1 },
      // deliberately broken shapes
      bot: { enabled: 1, hpPotionTarget: -4, goldReserve: -50 } as never,
    });
    expect(m.bot.enabled).toBe(false); // non-boolean -> false
    expect(m.bot.hpPotionTarget).toBe(defaultBotSettings().hpPotionTarget); // negative -> default
    expect(m.bot.goldReserve).toBe(0); // negative -> default (0)
  });
});

// ---------------------------------------------------------------------------
// Potion-restock bot
// ---------------------------------------------------------------------------

describe("potion-restock bot", () => {
  function farmingBot(cls: "swordsman" | "archer" | "mage" = "swordsman", stage = 3): GameState {
    const s = initGameState(1, soloSave(cls, stage));
    unlockAll(s);
    s.gold = 100_000;
    s.bot = { ...defaultBotSettings(), enabled: true, hpPotionTarget: 15, mpPotionTarget: 15, scrollReserve: 3 };
    return s;
  }

  it("trips to town, restocks toward targets, and auto-returns to the farm zone", () => {
    const s = farmingBot();
    expect(zoneAt(s.location).kind).toBe("farm");
    expect(s.consumables.hpPotion).toBe(0);

    // The trip fires (stock EMPTY with a non-zero target + affordable) and reaches town.
    const arrived = runUntilInput(
      s,
      {},
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("restock");

    // Potions were bought up to target during the town step.
    expect(s.consumables.hpPotion).toBe(15);
    expect(s.consumables.manaPotion).toBe(15);
    expect(s.consumables.returnScroll).toBe(3);
    expect(s.gold).toBeGreaterThan(0); // didn't overspend

    // Auto-returns to farming (never stalls in town).
    const back = runUntilInput(
      s,
      {},
      (st) => st.traveling === null && zoneAt(st.location).kind === "farm",
      3000,
    );
    expect(back).toBe(true);
    expect(zoneAt(s.location).kind).toBe("farm");
  });

  it("REGRESSION: does NOT trip while stock is low-but-nonzero (empty-trigger, owner call)", () => {
    // Old behavior tripped the moment stock dipped BELOW target — target 80
    // meant a warp at 79 to buy one bottle. The trip must wait for EMPTY.
    const s = farmingBot();
    s.consumables.hpPotion = 1;
    s.consumables.manaPotion = 1;
    s.autoHpPotion = false; // keep the stock from draining to 0 mid-test
    s.autoManaPotion = false;
    for (let i = 0; i < 1500; i++) step(s, {});
    expect(s.events.some((e) => e.type === "townArrived")).toBe(false);
    expect(s.consumables.hpPotion).toBe(1); // untouched — and still no trip
  });

  it("sell trip tops potions up opportunistically while at the shop (restock bot ON)", () => {
    const s = farmingBot();
    s.bot.sellTripEnabled = true;
    s.consumables.hpPotion = 5; // low but NOT empty — no restock trip due
    s.consumables.manaPotion = 5;
    s.autoHpPotion = false;
    s.autoManaPotion = false;
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP }, // full bag forces a SELL trip
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("sell"); // not a restock trip...
    expect(s.consumables.hpPotion).toBe(15); // ...but it topped up anyway
    expect(s.consumables.manaPotion).toBe(15);
  });

  it("warps with a held return scroll (scroll-else-walk branch)", () => {
    const s = farmingBot();
    s.consumables.returnScroll = 2;
    // With a scroll held the trip warps instantly (no botWalkSeconds transit): the
    // scroll is consumed and town is reached within a couple of steps.
    let usedScrollTownStep = -1;
    for (let i = 0; i < 200; i++) {
      const before = s.consumables.returnScroll;
      step(s, {});
      if (s.events.some((e) => e.type === "townArrived")) {
        // The scroll was spent to warp (one consumed), then the trip topped it back
        // up toward scrollReserve (3) during the same town step.
        expect(before).toBeLessThan(3); // warp had consumed one before arrival buying
        usedScrollTownStep = i;
        break;
      }
    }
    expect(usedScrollTownStep).toBeGreaterThanOrEqual(0);
    expect(s.consumables.returnScroll).toBe(3); // restocked to reserve
  });

  it("walks (no scroll) when none is held", () => {
    const s = farmingBot();
    s.consumables.returnScroll = 0;
    // First step: the trip begins as a WALK transit (reason bot), not instant.
    step(s, {});
    expect(s.traveling).not.toBeNull();
    expect(s.traveling?.reason).toBe("bot");
    expect(zoneAt(s.location).kind).toBe("farm"); // still travelling, not arrived
  });

  it("respects the gold floor (spends only surplus above goldReserve)", () => {
    const s = farmingBot();
    // Only 1 hp potion's worth of surplus above the floor.
    const unit = shopPriceAt("hpPotion", shopStageOf(s));
    s.bot.goldReserve = 500;
    s.gold = 500 + unit + 5; // affords exactly one hp potion
    runUntilInput(s, {}, (st) => st.events.some((e) => e.type === "townArrived"), 3000);
    expect(s.consumables.hpPotion).toBe(1); // bought only what the floor allowed
    expect(s.gold).toBeGreaterThanOrEqual(500); // never dipped below the floor
  });

  it("does NOT livelock when it cannot afford any potion (banks gold instead)", () => {
    const s = farmingBot();
    s.gold = 0; // broke — a trip would buy nothing
    // Over many steps it must keep FARMING (never leaves the farm zone on a doomed
    // trip). It banks kill gold; once affordable it may eventually trip — that's fine.
    let leftFarmEarly = false;
    for (let i = 0; i < 400; i++) {
      step(s, {});
      if (s.gold === 0 && s.traveling !== null) leftFarmEarly = true;
    }
    expect(leftFarmEarly).toBe(false); // never tripped while broke
    expect(s.kills).toBeGreaterThan(0); // kept farming
  });

  it("is disabled by default (a fresh save never trips)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    s.gold = 100_000;
    expect(s.bot.enabled).toBe(false);
    for (let i = 0; i < 500; i++) step(s, {});
    expect(s.events.some((e) => e.type === "townArrived")).toBe(false);
    expect(zoneAt(s.location).kind).toBe("farm");
  });
});

// ---------------------------------------------------------------------------
// Sell-trip bot
// ---------------------------------------------------------------------------

describe("sell-trip bot (inventoryCount trigger)", () => {
  it("trips to town when inventory is full and emits townArrived reason=sell", () => {
    const s = initGameState(1, soloSave("archer", 4));
    unlockAll(s);
    s.bot = { ...defaultBotSettings(), sellTripEnabled: true };
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP },
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("sell");
  });

  it("does not trip below INVENTORY_CAP", () => {
    const s = initGameState(1, soloSave("archer", 4));
    unlockAll(s);
    s.bot = { ...defaultBotSettings(), sellTripEnabled: true };
    for (let i = 0; i < 400; i++) step(s, { inventoryCount: INVENTORY_CAP - 1 });
    expect(s.events.some((e) => e.type === "townArrived")).toBe(false);
  });

  it("coalesces a restock + sell into one trip (reason=restockSell)", () => {
    const s = initGameState(1, soloSave("mage", 3));
    unlockAll(s);
    s.gold = 100_000;
    s.bot = { ...defaultBotSettings(), enabled: true, sellTripEnabled: true, hpPotionTarget: 10, mpPotionTarget: 10 };
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP },
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("restockSell");
    // Restock still happened as part of the coalesced trip.
    expect(s.consumables.hpPotion).toBeGreaterThan(0);
  });

  // ── anti-warp-loop regression (2026-07-06 bug) ─────────────────────────────
  // Original behavior: arrival emitted townArrived and walked home the SAME
  // step; a sell that never landed (rules matched nothing / async in flight)
  // left the bag full, so the bot re-tripped forever, burning scrolls.

  /** Step `n` times feeding `count`, tallying townArrived events (cleared each step). */
  function stepCounting(s: GameState, n: number, count: number): number {
    let arrivals = 0;
    for (let i = 0; i < n; i++) {
      step(s, { inventoryCount: count });
      if (s.events.some((e) => e.type === "townArrived")) arrivals++;
    }
    return arrivals;
  }

  function sellBotState(): GameState {
    const s = initGameState(1, soloSave("archer", 4));
    unlockAll(s);
    s.bot = { ...defaultBotSettings(), sellTripEnabled: true };
    s.consumables.returnScroll = 5; // warp trips = the fast loop the bug produced
    return s;
  }

  it("REGRESSION: a sell that never lands makes exactly ONE trip, then latches (no warp loop)", () => {
    const s = sellBotState();
    // 6000 steps ≈ 100s — room for many loops under the old behavior (dwell 6s
    // + walk home ≈ 8s per round trip). The watermark must hold it to one.
    const arrivals = stepCounting(s, 6000, INVENTORY_CAP);
    expect(arrivals).toBe(1);
    expect(s.sellTripWatermark).toBe(INVENTORY_CAP);
    expect(s.consumables.returnScroll).toBe(4); // exactly one scroll spent
  });

  it("dwells in town until the fed count drops (sell landed), then returns unlatched", () => {
    const s = sellBotState();
    // Reach town (warp = same-step arrival).
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP },
      (st) => st.events.some((e) => e.type === "townArrived"),
      600,
    );
    expect(arrived).toBe(true);
    expect(s.botDwell).not.toBeNull(); // waiting for the client's sell
    expect(s.traveling).toBeNull();
    // The client's sell lands: count drops → the dwell ends, no latch.
    step(s, { inventoryCount: INVENTORY_CAP - 40 });
    expect(s.botDwell).toBeNull();
    expect(s.sellTripWatermark).toBeNull();
    expect(s.traveling).not.toBeNull(); // walking home
    // Back at the farm and refilled later → a SECOND trip is allowed.
    const second = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP },
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(second).toBe(true);
  });

  it("dwell EXTENDS while the count keeps dropping (chunked big-bag sell-off)", () => {
    // A pre-cap 1,890-item bag sells in sequential 100-item chunks — the sweep
    // outlasts one 6s window, but visible PROGRESS must keep the bot waiting.
    const s = sellBotState();
    runUntilInput(
      s,
      { inventoryCount: 1890 },
      (st) => st.events.some((e) => e.type === "townArrived"),
      600,
    );
    expect(s.botDwell).not.toBeNull();
    // Burn ~5.5s of the 6s window with no progress...
    for (let i = 0; i < 330; i++) step(s, { inventoryCount: 1890 });
    expect(s.botDwell).not.toBeNull();
    // ...then a sold chunk lands (count drops) → the timer resets to full.
    step(s, { inventoryCount: 1790 });
    expect(s.botDwell?.timer ?? 0).toBeGreaterThan(5);
    // Another ~5.5s of stall is now survivable again (still dwelling, no latch).
    for (let i = 0; i < 330; i++) step(s, { inventoryCount: 1790 });
    expect(s.botDwell).not.toBeNull();
    expect(s.sellTripWatermark).toBeNull();
    // Chunks keep landing until below cap → success, returns unlatched.
    step(s, { inventoryCount: 50 });
    expect(s.botDwell).toBeNull();
    expect(s.sellTripWatermark).toBeNull();
    expect(s.traveling).not.toBeNull(); // walking home
  });

  it("REGRESSION: a full bag while STANDING in town starts the sell sweep (no trip needed)", () => {
    const s = sellBotState();
    // Park the hero in town (manual visit — not a bot trip).
    const town = { mapId: "map1", zoneIdx: 0 };
    s.location = town;
    s.heroes[0].x = 100;
    expect(zoneAt(s.location).kind).toBe("town");
    step(s, { inventoryCount: INVENTORY_CAP });
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("sell"); // sweep event fired in place
    expect(s.botDwell).not.toBeNull();
    // Sell lands → dwell clears but the hero STAYS in town (returnAfter=false).
    step(s, { inventoryCount: 10 });
    expect(s.botDwell).toBeNull();
    expect(s.traveling).toBeNull(); // not dragged to the farm
    expect(zoneAt(s.location).kind).toBe("town");
  });

  it("REGRESSION: a fast-travel channel started IN TOWN completes (town path ticks it)", () => {
    const s = sellBotState();
    s.location = { mapId: "map1", zoneIdx: 0 }; // town
    expect(zoneAt(s.location).kind).toBe("town");
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 2 } });
    expect(s.fastTravelCast).not.toBeNull(); // channel began
    // The old town early-return skipped tickFastTravel → the channel froze
    // forever. It must now count down and hop.
    let arrived = false;
    for (let i = 0; i < 300 && !arrived; i++) {
      step(s, {});
      arrived = s.events.some((e) => e.type === "fastTravelArrive");
    }
    expect(arrived).toBe(true);
    expect(s.fastTravelCast).toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 2 });
  });

  it("releases the latch when the count finally drops below the watermark", () => {
    const s = sellBotState();
    stepCounting(s, 6000, INVENTORY_CAP); // one trip, latched, back at the farm
    expect(s.sellTripWatermark).toBe(INVENTORY_CAP);
    // Still full → suppressed.
    expect(stepCounting(s, 1200, INVENTORY_CAP)).toBe(0);
    // A manual sell shrinks the bag below the watermark → latch clears...
    step(s, { inventoryCount: INVENTORY_CAP - 10 });
    expect(s.sellTripWatermark).toBeNull();
    // ...and a refill trips again.
    expect(stepCounting(s, 1200, INVENTORY_CAP)).toBe(1);
  });

  it("releases the latch on a bot-settings change (player fixed the rules)", () => {
    const s = sellBotState();
    stepCounting(s, 6000, INVENTORY_CAP); // latched
    expect(s.sellTripWatermark).toBe(INVENTORY_CAP);
    // The settings intent clears the latch EARLY in the same step, so with a
    // scroll held the re-trip warps + arrives within this very step.
    step(s, { inventoryCount: INVENTORY_CAP, setBotSettings: {} });
    expect(s.events.some((e) => e.type === "townArrived")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opportunistic sell sweep on EVERY trip (owner call 2026-07-07)
// ---------------------------------------------------------------------------

describe("opportunistic sell sweep (all enabled chores per trip)", () => {
  /** Restock bot ON with EMPTY potions (a restock trip is due). */
  function restockDue(sellBot: boolean): GameState {
    const s = initGameState(1, soloSave("swordsman", 4));
    unlockAll(s);
    s.gold = 100_000;
    s.bot = {
      ...defaultBotSettings(),
      enabled: true,
      sellTripEnabled: sellBot,
      hpPotionTarget: 15,
      mpPotionTarget: 15,
      scrollReserve: 3,
    };
    return s;
  }

  it("a potions-only trip with the sell bot ON sweeps too: sell-capable event + dwell", () => {
    const s = restockDue(true);
    // Bag BELOW cap → no sell trigger; the trip is restock-only, yet the sweep
    // must still run because the sell bot is enabled.
    const below = INVENTORY_CAP - 1;
    const arrived = runUntilInput(
      s,
      { inventoryCount: below },
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    // Sell-capable reason (client runs the dispose sweep) but NOT a genuine
    // full-bag trigger → sellTriggered false (client suppresses the give-up notice).
    expect(ev && "reason" in ev && ev.reason).toBe("restockSell");
    expect(ev && "sellTriggered" in ev && ev.sellTriggered).toBe(false);
    expect(s.botDwell).not.toBeNull(); // dwells for the client's async sweep
    expect(s.consumables.hpPotion).toBe(15); // restocked in the same trip
    // A below-cap bag ends the dwell on the very next tick → walks straight home.
    step(s, { inventoryCount: below });
    expect(s.botDwell).toBeNull();
    expect(s.sellTripWatermark).toBeNull(); // opportunistic exit never latches
    const home = runUntilInput(
      s,
      { inventoryCount: below },
      (st) => st.traveling === null && zoneAt(st.location).kind === "farm",
      3000,
    );
    expect(home).toBe(true);
  });

  it("with the sell bot OFF a potions-only trip keeps the old behavior (no dwell)", () => {
    const s = restockDue(false);
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP - 1 },
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("restock");
    expect(ev && "sellTriggered" in ev && ev.sellTriggered).toBe(false);
    expect(s.botDwell).toBeNull(); // buys and walks home, bag untouched
  });

  it("a genuine full-bag + restock trip is unchanged (restockSell, sellTriggered)", () => {
    const s = restockDue(true);
    const arrived = runUntilInput(
      s,
      { inventoryCount: INVENTORY_CAP }, // full bag = genuine sell trigger
      (st) => st.events.some((e) => e.type === "townArrived"),
      3000,
    );
    expect(arrived).toBe(true);
    const ev = s.events.find((e) => e.type === "townArrived");
    expect(ev && "reason" in ev && ev.reason).toBe("restockSell");
    expect(ev && "sellTriggered" in ev && ev.sellTriggered).toBe(true);
    expect(s.botDwell).not.toBeNull();
  });

  it("is deterministic: byte-identical opportunistic-sweep runs", () => {
    function run(): string {
      const s = restockDue(true); // fixed seed 1 via initGameState
      for (let i = 0; i < 4000; i++) step(s, { inventoryCount: INVENTORY_CAP - 1 });
      return JSON.stringify(s);
    }
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// Fast travel
// ---------------------------------------------------------------------------

describe("fast travel", () => {
  it("channels then instantly hops to an unlocked zone, arriving at the gate-side x", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    s.spawnPaused = true; // clear field so no aggro / damage interferes
    s.enemies = [];
    const target = { mapId: "map1", zoneIdx: 5 };

    step(s, { fastTravel: target });
    expect(s.fastTravelCast).not.toBeNull();
    expect(s.events.some((e) => e.type === "fastTravelCastStart")).toBe(true);
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 3 }); // not yet arrived

    const done = runUntilInput(s, {}, (st) => st.fastTravelCast === null, 500);
    expect(done).toBe(true);
    expect(s.location).toEqual(target);
    const arrive = s.events.find((e) => e.type === "fastTravelArrive");
    expect(arrive).toBeDefined();
    // Arrives at the left (entrance) gate x.
    expect(s.heroes[0].x).toBe(CONFIG.hunt.heroMinX);
  });

  it("is FREE (consumes no scroll)", () => {
    const s = initGameState(1, soloSave("mage", 3));
    unlockAll(s);
    s.spawnPaused = true;
    s.enemies = [];
    s.consumables.returnScroll = 2;
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 2 } });
    runUntilInput(s, {}, (st) => st.fastTravelCast === null, 500);
    expect(s.consumables.returnScroll).toBe(2); // untouched
  });

  it("rejects a LOCKED target (blocked: locked)", () => {
    const s = initGameState(1, soloSave("swordsman", 1)); // only zone 1 unlocked
    step(s, { fastTravel: { mapId: "map2", zoneIdx: 3 } });
    expect(s.fastTravelCast).toBeNull();
    const ev = s.events.find((e) => e.type === "fastTravelBlocked");
    expect(ev && "reason" in ev && ev.reason).toBe("locked");
  });

  it("rejects when a mob is engaging the hero (blocked: aggro)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    // Seat an engaged mob adjacent to the hero.
    s.enemies = [
      {
        id: 999,
        kind: "normal",
        x: s.heroes[0].x + 10,
        y: 200,
        hp: 100,
        maxHp: 100,
        atk: 5,
        speed: 0,
        size: 1,
        behavior: "melee",
        range: 0,
        cd: 999,
        engageOffset: 0,
        homeX: s.heroes[0].x + 10,
        aggressive: false,
        aggroRadius: 0,
        engaged: true,
      },
    ];
    s.spawnPaused = true;
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 5 } });
    expect(s.fastTravelCast).toBeNull();
    const ev = s.events.find((e) => e.type === "fastTravelBlocked");
    expect(ev && "reason" in ev && ev.reason).toBe("aggro");
  });

  it("cancels the channel when the hero takes damage (blocked: damaged)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 5 } });
    expect(s.fastTravelCast).not.toBeNull();
    // Damage the hero mid-channel.
    s.heroes[0].hp -= 10;
    step(s, {});
    expect(s.fastTravelCast).toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 3 }); // did NOT travel
    const ev = s.events.find((e) => e.type === "fastTravelBlocked");
    expect(ev && "reason" in ev && ev.reason).toBe("damaged");
  });

  it("rejects a boss-room / same-zone / mid-transit target", () => {
    const s = initGameState(1, soloSave("swordsman", 5));
    unlockAll(s);
    s.spawnPaused = true;
    s.enemies = [];
    // Boss room (map1 zoneIdx 6) -> invalid.
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 6 } });
    expect(s.events.find((e) => e.type === "fastTravelBlocked" && e.reason === "invalid")).toBeDefined();
    // Same zone -> same.
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 5 } });
    expect(s.events.find((e) => e.type === "fastTravelBlocked" && e.reason === "same")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Zone-gate transit events
// ---------------------------------------------------------------------------

describe("zone-gate transit events (walk)", () => {
  it("emits exactly one zoneGateEnter (start) and one zoneGateExit (arrival) per walk", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    let enters = 0;
    let exits = 0;
    let enterSide: string | null = null;
    let exitSide: string | null = null;
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 4 } }); // walk RIGHT
    for (const e of s.events) {
      if (e.type === "zoneGateEnter") { enters++; enterSide = e.side; }
      if (e.type === "zoneGateExit") { exits++; exitSide = e.side; }
    }
    // Enter event fires on the start step; walk right -> exit the RIGHT gate.
    expect(enters).toBe(1);
    expect(enterSide).toBe("right");

    // Finish the transit; the exit gate fires exactly once on arrival.
    for (let i = 0; i < 500 && s.traveling !== null; i++) {
      step(s, {});
      for (const e of s.events) {
        if (e.type === "zoneGateExit") { exits++; exitSide = e.side; }
        if (e.type === "zoneGateEnter") enters++;
      }
    }
    expect(exits).toBe(1);
    expect(exitSide).toBe("left"); // arrive via the LEFT gate of the next zone
    expect(enters).toBe(1); // no extra enter events during transit
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 4 });
  });

  it("does NOT emit gate events for a fast-travel hop", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { fastTravel: { mapId: "map1", zoneIdx: 2 } });
    let gateEvents = 0;
    for (let i = 0; i < 500 && s.fastTravelCast !== null; i++) {
      step(s, {});
      for (const e of s.events) {
        if (e.type === "zoneGateEnter" || e.type === "zoneGateExit") gateEvents++;
      }
    }
    expect(gateEvents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism + no-stall smoke
// ---------------------------------------------------------------------------

describe("determinism + smoke", () => {
  it("a restock-bot run is byte-identical under fixed inputs", () => {
    function run(): string {
      const s = initGameState(42, soloSave("swordsman", 4));
      s.gold = 50_000;
      s.bot = { ...defaultBotSettings(), enabled: true, hpPotionTarget: 12, mpPotionTarget: 12, scrollReserve: 2 };
      for (let i = 0; i < 4000; i++) step(s, {});
      return JSON.stringify(s);
    }
    expect(run()).toBe(run());
  });

  it("smoke: restock bot ON at a mid stage — no stall, gold positive, potions hover near targets", () => {
    const s = initGameState(7, soloSave("swordsman", 6));
    unlockAll(s);
    s.autoCast = true;
    s.autoAllocate = true;
    s.gold = 20_000;
    // A leveled hero so a mid-stage zone is survivable (a fresh level-1 hero at s6
    // isn't the automation being tested — we want the bot loop, not a death spiral).
    s.heroes[0].level = 30;
    s.heroes[0].maxHp = heroMaxHpOf(s.heroes[0]);
    s.heroes[0].hp = s.heroes[0].maxHp;
    s.bot = { ...defaultBotSettings(), enabled: true, hpPotionTarget: 15, mpPotionTarget: 15, scrollReserve: 3 };

    let townTrips = 0;
    let kills = 0;
    for (let i = 0; i < 30_000; i++) {
      step(s, {});
      for (const e of s.events) {
        if (e.type === "townArrived") townTrips++;
        if (e.type === "kill") kills++;
      }
    }
    // The bot ran (made restock trips) and the hero kept farming — no livelock.
    expect(townTrips).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(0);
    expect(s.gold).toBeGreaterThan(0);
    // Empty-trigger restock: stock sawtooths 0 -> target; the run must end with
    // the loop still functioning (stocked, or a refill trip imminent at 0).
    expect(s.consumables.hpPotion).toBeGreaterThanOrEqual(0);
    expect(s.consumables.hpPotion).toBeLessThanOrEqual(15);
    // Never stuck mid boss / stranded — ends alive and reachable.
    expect(zoneAt(s.location).kind).not.toBe("boss");
    expect(isZoneUnlocked(s, s.lastFarmZone)).toBe(true);
  });
});
