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
  botFarmTarget,
  gateX,
  isZoneUnlocked,
  townLocation,
  zoneAt,
} from "@/engine/systems/world";
import { npcInRange, townNpcConfig } from "@/engine/systems/townNpcs";
import type { BotSettings, TownNpcId } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** The restock predicate only reads these two potion counts (structurally compatible
 * with `ConsumableCounts` — kept narrow so callers outside `engine/` don't need that
 * type, per the same "duplicated deliberately" convention as `MAX_CLAIM_BATCH` etc.
 * elsewhere in this codebase). */
export interface BotRestockConsumables {
  hpPotion: number;
  manaPotion: number;
}

/** `{ needRestock, needSell }` — see `wantsBotTownTrip`'s doc. */
export interface BotTripWant {
  needRestock: boolean;
  needSell: boolean;
}

/** The town NPC the idle bot transacts with (buy/sell/salvage). The refine smith
 * (ลุงดึ๋ง) is deliberately PLAYER-ONLY — refine is never botted (M6 town NPCs ph.2). */
const MERCHANT: TownNpcId = "npc:pahpu";

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
 * Pure "does the bot want a town trip right now" predicate — the restock (hpShort/
 * mpShort vs `hpPotionTarget`/`mpPotionTarget` + spendable-gold affordability) and
 * sell-trip (bag at/over `INVENTORY_CAP`, not latched) decisions `updateBots` makes
 * while farming, extracted so a caller who ALREADY knows it's safe to ask (no
 * location/phase/traveling gate here — that's `updateBots`'s job) can evaluate it
 * without duplicating the arithmetic.
 *
 * Restock trips fire on EMPTY, not below-target (owner call 2026-07-06): a target of
 * 80 must NOT warp at 79 to buy one bottle — the trip happens when a tracked potion
 * type runs OUT (stock 0 with a non-zero target). The affordability gate prevents a
 * trip LIVELOCK — a broke hero that can't buy would otherwise trip, buy nothing,
 * return, and immediately re-trip without ever farming.
 *
 * M8 party (owner 2026-07-08, "ไม่ว่าจะเล่นเดี่ยวหรือปาร์ตี้ บอทยังคงต้องทำงานเหมือนเดิม"):
 * ALSO the pure core `GameClient`'s cohort branch calls (with the caller's OWN
 * virtualized wallet slice, not the raw shared `state.gold`/`state.consumables`) to
 * decide whether MY hero's bot wants a trip badly enough to leave the cohort and go
 * do it solo — see `cohortBotTrip.ts`'s module doc for the full leave/rejoin loop.
 */
export function wantsBotTownTrip(
  bot: BotSettings,
  consumables: BotRestockConsumables,
  gold: number,
  shopStage: number,
  inventoryCount: number | undefined,
  sellTripWatermark: number | null,
): BotTripWant {
  const hpShort = bot.hpPotionTarget > 0 && consumables.hpPotion <= 0;
  const mpShort = bot.mpPotionTarget > 0 && consumables.manaPotion <= 0;
  const spendable = Math.max(0, gold - bot.goldReserve);
  const canAfford =
    (hpShort && spendable >= shopPriceAt("hpPotion", shopStage)) ||
    (mpShort && spendable >= shopPriceAt("manaPotion", shopStage));
  const needRestock = bot.enabled && (hpShort || mpShort) && canAfford;
  const needSell =
    bot.sellTripEnabled &&
    typeof inventoryCount === "number" &&
    inventoryCount >= INVENTORY_CAP &&
    sellTripWatermark === null; // latched = a prior sweep sold nothing
  return { needRestock, needSell };
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
  // In-town WALK to the merchant (M6 town NPCs phase 2): after a bot trip arrives, the
  // hero walks to ป้าปุ๊'s anchor before ANY transaction arms. Runs BEFORE the dwell /
  // enabled gates (like the dwell below): even if the player toggles the bot off
  // mid-walk, the trip still completes its chores + walks home (no wedged trip state).
  if (state.botWalk !== null) {
    tickBotWalk(state);
    return;
  }

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

  // A prior sell sweep gave up with the bag still at `sellTripWatermark` items —
  // stay latched until the count actually drops below it (a manual/late sell
  // landed) so we never loop sweeps/trips that sell nothing.
  if (
    state.sellTripWatermark !== null &&
    typeof inventoryCount === "number" &&
    inventoryCount < state.sellTripWatermark
  ) {
    state.sellTripWatermark = null;
  }

  const { needRestock, needSell } = wantsBotTownTrip(
    bot,
    state.consumables,
    state.gold,
    shopStageOf(state),
    inventoryCount,
    state.sellTripWatermark,
  );

  const kind = zoneAt(state.location).kind;
  if (kind === "town") {
    if (state.heroes.length > 1) {
      // COHORT (M8, owner v1 2026-07-08): the bot never INITIATES a town trip (guarded
      // below), but if the shared party is standing in town with the bot on it must not
      // get STUCK — walk it back out to the farm frontier. No restock/sell chore here: a
      // cohort town visit is not a bot trip. Deterministic (same `botFarmTarget` on every
      // client); fires ONCE — beginTransit sets `traveling`, which the top-of-function
      // guard then short-circuits until arrival at the farm zone.
      botReturnToFarm(state);
      return;
    }
    // Already STANDING at the shop (death respawn while waiting, manual visit,
    // 2026-07-06 report: a full-bag hero parked in town never sold): restock
    // in place, and a due sell starts the SAME dwell+event a trip arrival
    // would — minus the walk home afterwards (`returnAfter: false`; a player
    // browsing the shop must not get dragged to the farm).
    if (needRestock) botRestock(state);
    if (needSell) {
      state.botDwell = {
        timer: CONFIG.bot.sellDwellSeconds,
        lastCount: null,
        returnAfter: false,
      };
      state.events.push({ type: "townArrived", reason: "sell", sellTriggered: true });
    }
    return;
  }
  if (kind !== "farm") return; // trips initiate from farming
  if (!needRestock && !needSell) return;
  // COHORT (M8, owner v1 2026-07-08): NEVER initiate a town trip when heroes.length > 1.
  // Location is cohort-shared, so one client's restock/sell decision would DRAG the whole
  // party to town (owner-confirmed live bug). Suppressed here at the decision point —
  // deterministic (same state on every client, so no desync). The UI surfaces the "potions
  // low" hint by DERIVING it from consumable counts + bot targets (hpShort/mpShort above),
  // so no new engine event is needed; the party tops up at a zone boundary, not mid-run.
  if (state.heroes.length > 1) return;

  beginBotTrip(state, needRestock, needSell);
}

/** One fixed-dt tick of the in-town sell dwell (see `updateBots`). */
function tickSellDwell(state: GameState, inventoryCount?: number): void {
  const dwell = state.botDwell;
  if (!dwell) return;
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
    if (dwell.returnAfter) botReturnToFarm(state);
    return;
  }
  // PROGRESS extends the wait: a pre-cap 1,000+ bag sells in sequential
  // 100-item chunks (server batch cap), easily outlasting one dwell window —
  // as long as the fed count keeps DROPPING between ticks, keep standing here.
  if (count !== null && dwell.lastCount !== null && count < dwell.lastCount) {
    dwell.timer = CONFIG.bot.sellDwellSeconds;
  }
  dwell.lastCount = count;
  dwell.timer -= FIXED_DT;
  if (dwell.timer <= 0) {
    // Gave up: bag still full and no progress. Latch so we don't re-trip.
    state.botDwell = null;
    if (count !== null) state.sellTripWatermark = count;
    if (dwell.returnAfter) botReturnToFarm(state);
  }
}

/**
 * One fixed-dt tick of the in-town walk to the merchant (M6 town NPCs phase 2). The bot
 * walks the hero from the town entry toward ป้าปุ๊'s anchor at hunt speed; once the hero
 * is within the NPC's interaction radius the trip's transactions ARM (`doBotBusiness`).
 * Deterministic (fixed anchor + fixed speed, no RNG). A manual command can't wedge it —
 * the walk drives `hero.x` directly and completes regardless of `hero.command` (which the
 * town phase never applies anyway). A force-move (death / manual transit) drops the walk.
 */
function tickBotWalk(state: GameState): void {
  const walk = state.botWalk;
  if (!walk) return;
  const hero = state.heroes[0];
  // Defensive: a walk only means something while standing in town with a live hero.
  if (!hero || state.traveling || zoneAt(state.location).kind !== "town") {
    state.botWalk = null;
    return;
  }
  // Arm the instant the hero is within the merchant's radius (already-there or landing).
  if (npcInRange(state, MERCHANT)) {
    state.botWalk = null;
    doBotBusiness(state, walk);
    return;
  }
  const target = townNpcConfig(MERCHANT).x;
  const stepPx = CONFIG.hunt.huntSpeed * FIXED_DT;
  const d = target - hero.x;
  hero.x += Math.abs(d) <= stepPx ? d : Math.sign(d) * stepPx;
  if (npcInRange(state, MERCHANT)) {
    state.botWalk = null;
    doBotBusiness(state, walk);
  }
}

/**
 * Run the bot's town chores AT the merchant (M6 town NPCs phase 2): restock + the
 * opportunistic sell/salvage sweep, emit `npcTrade` (the transaction window opened) then
 * `townArrived` (the client fires the sell API off it), and either dwell for the async
 * sell or walk straight home. Called ONLY once the hero has reached ป้าปุ๊'s radius. The
 * chore logic itself is unchanged from the pre-phase-2 `onBotTownArrival` (owner call
 * 2026-07-07: every trip runs ALL enabled chores) — only its TRIGGER moved to the anchor.
 */
function doBotBusiness(state: GameState, pending: { restock: boolean; sell: boolean }): void {
  // Opportunistic top-up: ANY bot trip restocks while at the shop (restock bot must be ON).
  if (pending.restock || state.bot.enabled) botRestock(state);

  // Opportunistic dispose: ANY bot trip runs the sell/salvage sweep when the sell bot is
  // ON. `pending.sell` alone marks a GENUINE full-bag trigger; `sellTriggered` carries
  // that to the client (it only shows the "nothing to dispose" notice for real sell trips).
  const doSell = pending.sell || state.bot.sellTripEnabled;
  const reason: "restock" | "sell" | "restockSell" =
    pending.restock && doSell ? "restockSell" : doSell ? "sell" : "restock";

  state.events.push({ type: "npcTrade", npcId: MERCHANT });
  state.events.push({ type: "townArrived", reason, sellTriggered: pending.sell });

  if (doSell) {
    // The sell is a CLIENT-side async API call fired off townArrived — dwell in town for
    // it instead of walking home this same step (see tickSellDwell). An opportunistic
    // sweep that finds a below-cap bag ends the dwell next tick, so a tidy potions trip
    // still walks home promptly.
    state.botDwell = { timer: CONFIG.bot.sellDwellSeconds, lastCount: null, returnAfter: true };
    return;
  }
  botReturnToFarm(state);
}

/** Walk home to the last farm zone (shared by restock-only arrival + dwell end).
 * Depth-scaled like the to-town walk (owner call 2026-07-06): returning to a
 * deep farm zone takes botWalkSeconds x zoneIdx, symmetric with the trip out. */
function botReturnToFarm(state: GameState): void {
  // QUEST LEADS: return to the quest's frontier field while an evolution quest pins
  // the hero, else the ordinary lastFarmZone (see `world.botFarmTarget`).
  const back = botFarmTarget(state);
  if (zoneAt(back).kind === "farm" && isZoneUnlocked(state, back)) {
    const depth = Math.max(1, back.zoneIdx);
    beginTransit(state, back, CONFIG.travel.botWalkSeconds * depth, "walk");
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
 *
 * M6 town NPCs phase 2 (owner: "the BOT must auto-walk to the NPC and do its business
 * normally"): the bot no longer transacts on arrival. It places the hero at the town
 * ENTRY (the right gate — where a returning-from-the-world hero comes in, so the walk is
 * deterministic regardless of the pre-transit farm x) and hands the trip's chores to the
 * in-town WALK (`tickBotWalk`). The transactions (restock + sell sweep) + `townArrived` +
 * `npcTrade` only fire once the hero reaches ป้าปุ๊'s radius (`doBotBusiness`). Every trip
 * still performs ALL enabled chores (owner call 2026-07-07) — only the trigger moved to
 * the anchor. No teleport-to-shop; the walk is a real, deterministic transit.
 */
export function onBotTownArrival(state: GameState): void {
  const pending = state.botPending ?? { restock: false, sell: false };
  state.botPending = null;
  // Place the hero at the town entry (right gate) so the walk to the merchant is a
  // fixed, deterministic distance (independent of where the trip started on the field).
  const hero = state.heroes[0];
  if (hero) hero.x = gateX(state.location.mapId, "right");
  state.botWalk = { restock: pending.restock, sell: pending.sell };
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
