/**
 * Idle-automation bots (M7.5 "Sell, Bots & Inventory UX") — the potion-restock bot
 * and the sell-trip bot.
 *
 * These are DETERMINISTIC, engine-side triggers in the exact spirit of autoReturn /
 * auto-potion (systems/consumables): a farming hero whose potion stock has dipped
 * below its target (restock) or whose inventory is full (sell) makes a TOWN ROUND
 * TRIP, then auto-returns to the last farm zone. The trip REUSES the existing world
 * transit machinery — it warps via a held ยันกลับเมือง (return scroll) if one is
 * available, else it walks a single direct transit home (like respawnToTown) — so it
 * never forks the death / auto-return flows. On arrival it buys potions (+ scrolls)
 * within a gold floor and emits `townArrived`; the CLIENT fires the sell API off that
 * event (the engine knows NOTHING about item instances / inventory — the client feeds
 * the transient `inventoryCount`). Trips COALESCE: a restock + a sell pending together
 * are one trip.
 *
 * PURITY / DETERMINISM: no RNG (the seeded stream stays wave-composition only), no
 * wall-clock. The bot config is engine-PERSISTED (SAVE v11, `state.bot`), unlike the
 * UI-mirrored autoReturn toggle, so the automation survives a reload. Both bots are
 * OFF by default, so a save/sim with untouched settings is byte-identical to pre-M7.5.
 */

import { CONFIG } from "@/engine/config";
import { INVENTORY_CAP } from "@/engine/config/items";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp } from "@/engine/core/math";
import {
  buyShopItem,
  shopPriceAt,
  shopStageOf,
} from "@/engine/systems/consumables";
import {
  beginTransit,
  isZoneUnlocked,
  townLocation,
  zoneAt,
} from "@/engine/systems/world";
import type { BotSettings } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** A fresh BotSettings block (both bots OFF — cold-start / sim parity). */
export function defaultBotSettings(): BotSettings {
  return { ...CONFIG.bot.defaults };
}

const TARGET_CAP = CONFIG.shop.stackCap;

/** A non-negative integer target clamped to the stack cap. */
function asTarget(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fallback;
  return clamp(Math.floor(v), 0, TARGET_CAP);
}

/**
 * Normalise a possibly-partial / foreign BotSettings to the current shape (SAVE
 * v11): booleans coerced, targets clamped to [0, stackCap], the gold floor a finite
 * non-negative amount. Idempotent (a well-formed block round-trips unchanged), so
 * the server's migrate-on-every-save never drifts a player's settings.
 */
export function normalizeBotSettings(saved: Partial<BotSettings> | undefined): BotSettings {
  const d = CONFIG.bot.defaults;
  if (!saved) return { ...d };
  const floor = saved.goldReserve;
  return {
    enabled: saved.enabled === true,
    sellTripEnabled: saved.sellTripEnabled === true,
    hpPotionTarget: asTarget(saved.hpPotionTarget, d.hpPotionTarget),
    mpPotionTarget: asTarget(saved.mpPotionTarget, d.mpPotionTarget),
    scrollReserve: asTarget(saved.scrollReserve, d.scrollReserve),
    goldReserve:
      typeof floor === "number" && Number.isFinite(floor) && floor >= 0
        ? Math.floor(floor)
        : d.goldReserve,
  };
}

/**
 * Apply a partial settings update from the `setBotSettings` intent onto `state.bot`,
 * clamping via `normalizeBotSettings`. Merges over the current settings so the UI can
 * toggle one field at a time.
 */
export function setBotSettings(state: GameState, patch: Partial<BotSettings>): void {
  state.bot = normalizeBotSettings({ ...state.bot, ...patch });
  // A settings change is the player adjusting the automation (e.g. fixing
  // auto-sell rules after a gave-up trip) — drop the failure latch so the next
  // full-bag check may trip again.
  state.sellTripWatermark = null;
}

/**
 * Per-step bot trigger check (called from step in the battle path). Initiates a town
 * trip when a restock and/or sell is due while FARMING; a no-op otherwise (both bots
 * off, not in a farm zone, mid-transit / mid-cast, dead, or nothing pending).
 *
 * `inventoryCount` is the client-fed transient item count (undefined when the client
 * doesn't track it) — the sell-trip trigger.
 */
export function updateBots(state: GameState, inventoryCount?: number): void {
  // In-town SELL-trip dwell (anti-warp-loop, 2026-07-06): stand in town until the
  // client's async sell shrinks the fed count below the cap (success — return
  // early) or the dwell times out (give up — latch the watermark so a
  // rules-match-nothing sweep can't re-trip forever). Runs BEFORE the enabled
  // gate: even if the player disables the bot mid-dwell, the trip still walks home.
  if (state.botDwell !== null) {
    tickSellDwell(state, inventoryCount);
    return;
  }

  const bot = state.bot;
  if (!bot.enabled && !bot.sellTripEnabled) return;
  if (state.traveling || state.fastTravelCast) return;
  if (state.phase !== "battle") return; // never mid boss / victory
  const hero = state.heroes[0];
  if (!hero || hero.dead) return;

  // Restock trips fire on EMPTY, not below-target (owner call 2026-07-06): a
  // target of 80 must NOT warp at 79 to buy one bottle — the trip happens when a
  // tracked potion type runs OUT (stock 0 with a non-zero target), and the town
  // stop then refills all the way to the targets. Between trips, any OTHER bot
  // trip (e.g. a sell trip) opportunistically tops potions up while it's at the
  // shop anyway (see onBotTownArrival), so a dry spell is rare in practice.
  // The affordability gate below prevents a trip LIVELOCK — a broke hero that
  // can't buy would otherwise trip, buy nothing, return, and immediately re-trip
  // without ever farming. So the bot waits at the farm, banking gold, until a
  // restock trip is actually worthwhile.
  const hpShort = bot.hpPotionTarget > 0 && state.consumables.hpPotion <= 0;
  const mpShort = bot.mpPotionTarget > 0 && state.consumables.manaPotion <= 0;
  const spendable = Math.max(0, state.gold - bot.goldReserve);
  const stage = shopStageOf(state);
  const canAfford =
    (hpShort && spendable >= shopPriceAt("hpPotion", stage)) ||
    (mpShort && spendable >= shopPriceAt("manaPotion", stage));
  const needRestock = bot.enabled && (hpShort || mpShort) && canAfford;

  const kind = zoneAt(state.location).kind;
  if (kind === "town") {
    // Already STANDING at the shop (death respawn while waiting, manual visit):
    // restock in place — walking to the farm just to trip straight back here
    // would be an absurd round trip.
    if (needRestock) botRestock(state);
    return;
  }
  if (kind !== "farm") return; // trips initiate from farming

  // A prior sell trip gave up with the bag still at `sellTripWatermark` items —
  // stay latched until the count actually drops below it (a manual/late sell
  // landed) so we never loop scroll-burning trips that sell nothing.
  if (
    state.sellTripWatermark !== null &&
    typeof inventoryCount === "number" &&
    inventoryCount < state.sellTripWatermark
  ) {
    state.sellTripWatermark = null;
  }

  const needSell =
    bot.sellTripEnabled &&
    typeof inventoryCount === "number" &&
    inventoryCount >= INVENTORY_CAP &&
    state.sellTripWatermark === null; // latched = a prior trip sold nothing
  if (!needRestock && !needSell) return;

  beginBotTrip(state, needRestock, needSell);
}

/** One fixed-dt tick of the in-town sell dwell (see `updateBots`). */
function tickSellDwell(state: GameState, inventoryCount?: number): void {
  // Defensive: a dwell only means something while standing in town. If the state
  // was force-moved (death, manual walk queued the same frame), just drop it.
  if (state.traveling || zoneAt(state.location).kind !== "town") {
    state.botDwell = null;
    return;
  }
  const count = typeof inventoryCount === "number" ? inventoryCount : null;
  if (count !== null && count < INVENTORY_CAP) {
    // The client's sell landed — bag has room again. Success: no latch.
    state.botDwell = null;
    state.sellTripWatermark = null;
    botReturnToFarm(state);
    return;
  }
  state.botDwell = (state.botDwell ?? 0) - FIXED_DT;
  if (state.botDwell <= 0) {
    // Gave up: bag still full. Latch the count so we don't re-trip until it drops.
    state.botDwell = null;
    if (count !== null) state.sellTripWatermark = count;
    botReturnToFarm(state);
  }
}

/** Walk home to the last farm zone (shared by restock-only arrival + dwell end). */
function botReturnToFarm(state: GameState): void {
  const back = state.lastFarmZone;
  if (zoneAt(back).kind === "farm" && isZoneUnlocked(state, back)) {
    beginTransit(state, back, CONFIG.world.transitSeconds, "walk");
  }
}

/**
 * Begin the town trip: warp via a held return scroll (a 0-timer transit so the ONE
 * arrival path in step's transit block runs — instant like the scroll), else a
 * single direct WALK-time transit home. Marks the pending purpose so the arrival
 * handler knows what to do. The scroll is spent whenever one is held (its reserve is
 * a RESTOCK target, not a spend gate — the trip tops it back up in town).
 */
function beginBotTrip(state: GameState, restock: boolean, sell: boolean): void {
  const town = townLocation();
  if (!town) return;
  state.botPending = { restock, sell };
  if ((state.consumables.returnScroll ?? 0) > 0) {
    state.consumables.returnScroll -= 1;
    beginTransit(state, town, 0, "bot"); // warp: arrives this same step
  } else {
    // Walk time scales with how DEEP the hero is (zones from town) — a flat
    // 1.2s from anywhere made the scroll a pointless purchase (it "saved"
    // nothing). Deep-zone farmers now feel the walk; the scroll is the upgrade.
    const depth = Math.max(1, state.location.zoneIdx);
    beginTransit(state, town, CONFIG.travel.botWalkSeconds * depth, "bot");
  }
}

/**
 * Town arrival for a bot trip (called from step when a "bot" transit reaches town).
 * Restocks potions + scrolls within the gold floor, emits `townArrived` (the client
 * fires the sell API off it when selling is involved), then begins the auto-return
 * walk to the last farm zone. Always returns to farming — the whole point of the bot.
 */
export function onBotTownArrival(state: GameState): void {
  const pending = state.botPending ?? { restock: false, sell: false };
  state.botPending = null;

  // Opportunistic top-up: ANY bot trip restocks while it's standing at the shop
  // anyway (the restock bot must be ON — a sell-only player who left it off
  // clearly doesn't want gold auto-spent on potions).
  if (pending.restock || state.bot.enabled) botRestock(state);

  const reason: "restock" | "sell" | "restockSell" =
    pending.restock && pending.sell ? "restockSell" : pending.sell ? "sell" : "restock";
  state.events.push({ type: "townArrived", reason });

  if (pending.sell) {
    // The sell is a CLIENT-side async API call fired off the townArrived event —
    // dwell in town for it instead of walking home in this same step (the
    // original walk-home-immediately behavior warp-looped: bag never shrank
    // before the next full-bag trigger back at the farm).
    state.botDwell = CONFIG.bot.sellDwellSeconds;
    return;
  }
  botReturnToFarm(state);
}

/** Buy potions up to their targets, then scrolls up to the reserve, all within the
 * gold floor (spend only surplus above `goldReserve`). Reuses the town-only,
 * partial-safe `buyShopItem`; each buy is re-budgeted from the reduced gold. */
function botRestock(state: GameState): void {
  const bot = state.bot;
  buyToTarget(state, "hpPotion", bot.hpPotionTarget, bot.goldReserve);
  buyToTarget(state, "manaPotion", bot.mpPotionTarget, bot.goldReserve);
  buyToTarget(state, "returnScroll", bot.scrollReserve, bot.goldReserve);
}

function buyToTarget(
  state: GameState,
  item: "hpPotion" | "manaPotion" | "returnScroll",
  target: number,
  goldReserve: number,
): void {
  const have = state.consumables[item] ?? 0;
  if (have >= target) return;
  const unit = shopPriceAt(item, shopStageOf(state));
  if (unit <= 0) return;
  const spendable = Math.max(0, state.gold - goldReserve);
  const n = Math.min(target - have, Math.floor(spendable / unit));
  if (n <= 0) return;
  buyShopItem(state, item, n);
}
