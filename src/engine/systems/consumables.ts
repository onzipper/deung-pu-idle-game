/**
 * NPC-shop consumables (M6 "เมืองหลัก + NPC shops", ROADMAP task) — the game's
 * FIRST real gold sink and the idle-sustain layer.
 *
 * Three fungible, non-tradable, stackable items bought with gold IN TOWN (the NPC
 * is there — GDD): hp/mana potions (restore a % of the pool, per-type cooldown)
 * and a return scroll (teleport to town). They are held as engine-level COUNTS in
 * the save (SAVE v9), NOT M7 item-instances (see entities `ShopItemId`).
 *
 * PURITY / DETERMINISM: no RNG (the seeded stream stays wave-composition only), no
 * wall-clock. Auto-use is a deterministic, threshold-gated, per-type-cooldown
 * decision at the step level, so `(state, dt, input, seed)` -> next state is exact.
 * The AUTO-USE toggles + thresholds are UI-owned (mirrored onto `state` each frame
 * like `autoCast`); this module only READS them.
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { arriveAtZone, townLocation, zoneAt } from "@/engine/systems/world";
import type { ConsumableCounts, ShopItemId } from "@/engine/entities";
import type { GameState } from "@/engine/state";

const SHOP = CONFIG.shop;

/** Catalog order (extensible — an M8 warp/party-summon item appends here). */
export const SHOP_ITEMS: readonly ShopItemId[] = [
  "hpPotion",
  "manaPotion",
  "returnScroll",
];

/** All-zero consumable stacks (fresh start / reset). */
export function emptyConsumables(): ConsumableCounts {
  return { hpPotion: 0, manaPotion: 0, returnScroll: 0 };
}

/** Gold price of `item` at content `stage` (stage-scaled — see CONFIG.shop). */
export function shopPriceAt(item: ShopItemId, stage: number): number {
  const base = SHOP.items[item].basePrice;
  return Math.round(base * Math.pow(SHOP.priceStageBase, Math.max(0, stage - 1)));
}

/**
 * The stage that shop prices scale by. The NPC lives in TOWN (always the map1
 * left-edge zone, whose content stage is 1), so pricing by `state.stage` would
 * flatten the stage-scaling to base prices forever. Price instead by the player's
 * FARMING DEPTH (`lastFarmZone`'s stage) — their economic tier — so a frontier
 * player's potions cost more (tracking their higher gold income), keeping the sink
 * meaningful at any depth.
 */
export function shopStageOf(state: GameState): number {
  return zoneAt(state.lastFarmZone).stage;
}

/** Whether the two potions can be USED right now (alive hero, stock, off cooldown,
 * pool not already full). A pure read for the UI quick-use buttons. */
export function canUseConsumable(state: GameState, item: ShopItemId): boolean {
  if (item !== "hpPotion" && item !== "manaPotion") return false;
  const hero = state.heroes[0];
  if (!hero || hero.dead) return false;
  if ((state.consumables[item] ?? 0) <= 0) return false;
  if ((state.consumableCds[item] ?? 0) > 0) return false;
  return item === "hpPotion" ? hero.hp < hero.maxHp : hero.mana < hero.maxMana;
}

/**
 * Tick every per-type use cooldown one fixed step. Called unconditionally at the
 * top of `step()` so a cooldown counts down in every phase (town/travel/battle).
 */
export function tickConsumableCds(state: GameState): void {
  for (const k in state.consumableCds) {
    const id = k as ShopItemId;
    const cd = state.consumableCds[id] ?? 0;
    if (cd > 0) state.consumableCds[id] = Math.max(0, cd - FIXED_DT);
  }
}

/**
 * Buy `qty` of `item` — ONLY valid while standing in the TOWN zone (the NPC is
 * there — GDD; reject elsewhere). Deducts stage-scaled gold and adds to the
 * (stack-capped) count. PARTIAL by design: buys as many as fit in gold AND the
 * remaining stack room, so a "buy N" never over-charges. No-op (false) outside
 * town, at qty <= 0, when the stack is full, or when even one is unaffordable.
 */
export function buyShopItem(state: GameState, item: ShopItemId, qty = 1): boolean {
  if (zoneAt(state.location).kind !== "town") return false;
  if (!SHOP_ITEMS.includes(item)) return false;
  const want = Math.floor(qty);
  if (want <= 0) return false;
  const have = state.consumables[item] ?? 0;
  const room = SHOP.stackCap - have;
  if (room <= 0) return false;
  const unit = shopPriceAt(item, shopStageOf(state));
  if (unit <= 0) return false;
  const n = Math.min(want, room, Math.floor(state.gold / unit));
  if (n <= 0) return false;
  const cost = unit * n;
  state.gold -= cost;
  state.consumables[item] = have + n;
  state.events.push({ type: "shopPurchase", item, qty: n, cost });
  return true;
}

/**
 * Use one potion (`hpPotion` / `manaPotion`) on the solo hero: restore
 * `restoreFrac` of the relevant MAX pool, consume one, start the per-type
 * cooldown, emit `consumableUsed`. No-op (false) for the scroll (use
 * `applyReturnScroll`), a dead/absent hero, an empty stack, on cooldown, or when the
 * pool is already full (never wastes a potion — protects the resource for both
 * manual taps and auto-use).
 */
export function applyConsumable(state: GameState, item: ShopItemId): boolean {
  if (item !== "hpPotion" && item !== "manaPotion") return false;
  const hero = state.heroes[0];
  if (!hero || hero.dead) return false;
  if ((state.consumables[item] ?? 0) <= 0) return false;
  if ((state.consumableCds[item] ?? 0) > 0) return false;
  const def = SHOP.items[item];
  if (item === "hpPotion") {
    if (hero.hp >= hero.maxHp) return false;
    hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * def.restoreFrac);
  } else {
    if (hero.mana >= hero.maxMana) return false;
    hero.mana = Math.min(hero.maxMana, hero.mana + hero.maxMana * def.restoreFrac);
  }
  state.consumables[item] -= 1;
  state.consumableCds[item] = def.cooldown;
  state.events.push({ type: "consumableUsed", item });
  return true;
}

/**
 * Consume one return scroll and teleport to TOWN from anywhere (instant — no walk
 * transit; the scroll IS the fast travel). No-op (false) if none held, no town is
 * configured, or the hero is already in town. Emits `townReturned`; the arrival is
 * a normal town arrival, so the standard auto-return rule then applies if toggled
 * (arriveAtZone "scroll" branch — pop to town, then head back to farming if
 * `autoReturn` is on; turn it off first to stay and shop).
 */
export function applyReturnScroll(state: GameState): boolean {
  if ((state.consumables.returnScroll ?? 0) <= 0) return false;
  const town = townLocation();
  if (!town) return false;
  if (zoneAt(state.location).kind === "town") return false; // already there
  state.consumables.returnScroll -= 1;
  state.traveling = null; // instant — cancel any in-flight walk
  arriveAtZone(state, town, "scroll");
  state.events.push({ type: "townReturned", mapId: town.mapId });
  return true;
}

/**
 * Per-step consumable resolution (battle path): a manual quick-use (once per
 * drained input) then threshold-gated AUTO-USE of the two potions. Auto-use reads
 * the UI-owned toggles/thresholds off `state`; the per-type cooldown (ticked in
 * `tickConsumableCds`) keeps it from double-drinking. Manual runs first so a tap
 * and an auto-trigger never both spend on the same type the same step.
 */
export function processConsumables(state: GameState, manualUse?: ShopItemId): void {
  const hero = state.heroes[0];
  if (!hero || hero.dead) return;
  if (manualUse) applyConsumable(state, manualUse);
  if (
    state.autoHpPotion &&
    hero.maxHp > 0 &&
    hero.hp / hero.maxHp < state.autoHpThreshold
  ) {
    applyConsumable(state, "hpPotion");
  }
  if (
    state.autoManaPotion &&
    hero.maxMana > 0 &&
    hero.mana / hero.maxMana < state.autoManaThreshold
  ) {
    applyConsumable(state, "manaPotion");
  }
}
