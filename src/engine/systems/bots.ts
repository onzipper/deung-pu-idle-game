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
  const bot = state.bot;
  if (!bot.enabled && !bot.sellTripEnabled) return;
  if (state.traveling || state.fastTravelCast) return;
  if (state.phase !== "battle") return; // never mid boss / victory
  if (zoneAt(state.location).kind !== "farm") return; // trips initiate from farming
  const hero = state.heroes[0];
  if (!hero || hero.dead) return;

  // Restock is due only if a potion is below target AND the hero can afford at least
  // ONE of the short potions within the gold floor. The affordability gate prevents a
  // trip LIVELOCK — a broke hero that can't buy would otherwise trip to town, buy
  // nothing, return, and immediately re-trip without ever farming. So the bot waits at
  // the farm, banking gold, until a restock trip is actually worthwhile.
  const hpShort = state.consumables.hpPotion < bot.hpPotionTarget;
  const mpShort = state.consumables.manaPotion < bot.mpPotionTarget;
  const spendable = Math.max(0, state.gold - bot.goldReserve);
  const stage = shopStageOf(state);
  const canAfford =
    (hpShort && spendable >= shopPriceAt("hpPotion", stage)) ||
    (mpShort && spendable >= shopPriceAt("manaPotion", stage));
  const needRestock = bot.enabled && (hpShort || mpShort) && canAfford;
  const needSell =
    bot.sellTripEnabled &&
    typeof inventoryCount === "number" &&
    inventoryCount >= INVENTORY_CAP;
  if (!needRestock && !needSell) return;

  beginBotTrip(state, needRestock, needSell);
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
    beginTransit(state, town, CONFIG.travel.botWalkSeconds, "bot");
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

  if (pending.restock) botRestock(state);

  const reason: "restock" | "sell" | "restockSell" =
    pending.restock && pending.sell ? "restockSell" : pending.sell ? "sell" : "restock";
  state.events.push({ type: "townArrived", reason });

  const back = state.lastFarmZone;
  if (zoneAt(back).kind === "farm" && isZoneUnlocked(state, back)) {
    beginTransit(state, back, CONFIG.world.transitSeconds, "walk");
  }
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
