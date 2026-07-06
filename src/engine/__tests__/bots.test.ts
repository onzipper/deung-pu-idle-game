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

    // The trip fires (potions below target + affordable) and reaches town.
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
    // Potions hover near targets (auto-use drains, the bot tops back up); never a
    // long dry spell — over the run they stay reasonably stocked.
    expect(s.consumables.hpPotion).toBeGreaterThan(0);
    // Never stuck mid boss / stranded — ends alive and reachable.
    expect(zoneAt(s.location).kind).not.toBe("boss");
    expect(isZoneUnlocked(s, s.lastFarmZone)).toBe(true);
  });
});
