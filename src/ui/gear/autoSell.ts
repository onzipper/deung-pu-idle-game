/**
 * M7.5→M7.7 auto-dispose rules — pure selection of which owned instances a
 * town-trip (manual bulk path OR the bot's `townArrived` reason "sell"/
 * "restockSell" executor in `GameClient.tsx`) should SELL vs SALVAGE. No
 * React/fetch here (headlessly testable, `__tests__/autoSell.test.ts`).
 *
 * Rules v2 (2026-07-07, M7.7 salvage-by-rarity): each of common/rare gets a
 * 3-way action — "off" | "sell" | "salvage" — instead of the old two booleans.
 *
 * Rules v3 (2026-07-07, owner "option A"): epic gets the SAME 3-way action
 * field (`rules.epic`, defaults "off" so existing players see NO behavior
 * change), but its "กันของดี" keep-guard protection is FORCED ON regardless of
 * the global `keepBetterStat` toggle — an epic may only be disposed when it's
 * strictly worse than what's equipped in its slot AND isn't the best
 * class-equippable candidate for an empty slot. `keepBetterStat` still governs
 * common/rare as before; it can never be used to strip an epic of protection.
 *
 * `keepBetterStat` (plus the forced epic case) guards BOTH actions
 * identically: it decides whether an instance is a disposal CANDIDATE at all;
 * the per-rarity action then decides whether that candidate is sold or
 * salvaged. The guard protects:
 *  - a SLOT WITH GEAR EQUIPPED: any candidate whose flat stat total BEATS the
 *    equipped item (a real upgrade survives the sweep), and
 *  - an EMPTY slot: the single BEST candidate equippable by the hero's class
 *    (your future first equip is kept; the other 97 copies are disposed).
 *    An empty slot must NOT keep everything (the original 0-baseline bug that
 *    warp-looped the bot) and must NOT keep nothing (selling your only weapon).
 *
 * `selectAutoSellSalvageIds` runs ONE sweep over the inventory and returns
 * `{ sellIds, salvageIds }` — deliberately not two independent sweeps, so the
 * empty-slot "keep ONE best backup" pick sees the whole candidate pool exactly
 * once (two separate sweeps could each decide differently and either keep
 * zero backups or keep two).
 */

import type { GearSlot, HeroClass, ItemRarity } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

/** Per-rarity disposal action. "off" = never touched by the sweep. */
export type AutoSellAction = "off" | "sell" | "salvage";

export interface AutoSellRules {
  common: AutoSellAction;
  rare: AutoSellAction;
  /** Epic's own 3-way action (v3, owner "option A"). Optional + defaults "off"
   * so any pre-v3 caller (existing tests, stale localStorage) that omits this
   * field keeps the old "epic never disposes" behavior byte-identical. */
  epic?: AutoSellAction;
  /** Keep-guard: never dispose of a stat upgrade over what's equipped; on an
   * empty slot, keep the best class-equippable candidate (see module doc).
   * Epic is ALWAYS guarded regardless of this flag (see `isGuarded`). */
  keepBetterStat: boolean;
}

export interface AutoSellSalvageIds {
  sellIds: string[];
  salvageIds: string[];
}

/** The minimal per-template shape this module needs (a subset of the engine's
 * `ItemTemplate` — deliberately narrow so this stays testable without an
 * engine-config fixture). `classReq`/`tier` feed the empty-slot best-backup
 * pick; omitting them treats an item as equippable / tier 0. */
export interface SellableTemplate {
  rarity: ItemRarity;
  slot: GearSlot;
  stats: { atk?: number; def?: number; hp?: number };
  classReq?: HeroClass | null;
  tier?: number;
}

function statSum(stats: SellableTemplate["stats"]): number {
  return (stats.atk ?? 0) + (stats.def ?? 0) + (stats.hp ?? 0);
}

function equippableBy(t: SellableTemplate, cls: HeroClass | undefined): boolean {
  if (t.classReq === undefined || t.classReq === null) return true;
  return cls === undefined || t.classReq === cls;
}

function actionFor(rarity: ItemRarity, rules: AutoSellRules): AutoSellAction {
  if (rarity === "epic") return rules.epic ?? "off"; // v3: real toggle, default off (keep)
  if (rarity === "common") return rules.common;
  return rules.rare;
}

/** Whether the keep-guard applies to this rarity right now. Epic is FORCED
 * guarded — the owner's "กันของดี" protection can never be turned off for it,
 * even when the global `keepBetterStat` toggle is off (that toggle only
 * governs common/rare). */
function isGuarded(rarity: ItemRarity, rules: AutoSellRules): boolean {
  return rarity === "epic" || rules.keepBetterStat;
}

/**
 * Selects instance ids to dispose of, split by action. NEVER selects an
 * equipped item (belt-and-braces — the server's sell/salvage endpoints reject
 * those anyway, `reason: "equipped"`). A template missing from `templates`
 * (stale/retired) is skipped defensively rather than crashing the sweep.
 * `heroClass` scopes the empty-slot best-backup pick to items the hero can
 * actually wear.
 */
export function selectAutoSellSalvageIds(
  items: readonly InventoryItem[],
  templates: Record<string, SellableTemplate>,
  rules: AutoSellRules,
  heroClass?: HeroClass,
): AutoSellSalvageIds {
  // Per-slot equipped stat-total baseline for the keep-guard.
  const equippedStatSum: Partial<Record<GearSlot, number>> = {};
  for (const item of items) {
    if (!item.equippedSlot) continue;
    const t = templates[item.templateId];
    if (t) equippedStatSum[item.equippedSlot] = statSum(t.stats);
  }

  // Empty-slot best-backup pick: the single strongest class-equippable
  // candidate per slot WITHOUT anything equipped (stat total, then tier, then
  // instanceId for a deterministic tie-break). This scans ALL disposable
  // candidates regardless of sell-vs-salvage action, since the guard is about
  // "is this a candidate at all", not which action would apply to it.
  const bestBackup: Partial<Record<GearSlot, string>> = {};
  for (const item of items) {
    if (item.equippedSlot !== null) continue;
    const t = templates[item.templateId];
    if (!t || equippedStatSum[t.slot] !== undefined) continue; // slot has gear
    if (actionFor(t.rarity, rules) === "off") continue; // not a candidate at all
    if (!isGuarded(t.rarity, rules)) continue; // this rarity isn't protected right now
    if (!equippableBy(t, heroClass)) continue;
    const incumbentId = bestBackup[t.slot];
    if (incumbentId === undefined) {
      bestBackup[t.slot] = item.instanceId;
      continue;
    }
    const incumbent = items.find((i) => i.instanceId === incumbentId);
    const it = incumbent ? templates[incumbent.templateId] : undefined;
    const better =
      !it ||
      statSum(t.stats) > statSum(it.stats) ||
      (statSum(t.stats) === statSum(it.stats) &&
        ((t.tier ?? 0) > (it.tier ?? 0) ||
          ((t.tier ?? 0) === (it.tier ?? 0) && item.instanceId < incumbentId)));
    if (better) bestBackup[t.slot] = item.instanceId;
  }

  const sellIds: string[] = [];
  const salvageIds: string[] = [];
  for (const item of items) {
    if (item.equippedSlot !== null) continue; // never touch equipped gear
    const t = templates[item.templateId];
    if (!t) continue;
    const action = actionFor(t.rarity, rules);
    if (action === "off") continue;
    if (isGuarded(t.rarity, rules)) {
      const baseline = equippedStatSum[t.slot];
      // Slot has gear: keep only genuine upgrades. Empty slot: keep only the
      // best-backup pick (see module doc — never everything, never nothing).
      if (baseline !== undefined && statSum(t.stats) > baseline) continue;
      if (baseline === undefined && bestBackup[t.slot] === item.instanceId) continue;
    }
    if (action === "sell") sellIds.push(item.instanceId);
    else salvageIds.push(item.instanceId);
  }
  return { sellIds, salvageIds };
}
