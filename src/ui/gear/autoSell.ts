/**
 * M7.5 auto-sell rules — pure selection of which owned instances a sell-trip
 * (manual bulk button OR the bot's `townArrived` reason "sell"/"restockSell"
 * executor in `GameClient.tsx`) should sell. No React/fetch here (headlessly
 * testable, `__tests__/autoSell.test.ts`).
 *
 * Rules v1.1 (2026-07-06, after the "bot never sells" report): epic NEVER
 * auto-sells (no `sellEpic` field — the rule doesn't exist, not just defaulted
 * off); common AND rare both default ON. Rare must default ON because the
 * catalog's rarity tracks TIER (t3-5 = all rare): from stage 6 onward every
 * drop is rare, so the old common-only default gave the bot literally nothing
 * it was allowed to sell. What makes rare-ON safe is the `keepBetterStat`
 * guard, which protects:
 *  - a SLOT WITH GEAR EQUIPPED: any candidate whose flat stat total BEATS the
 *    equipped item (a real upgrade survives the sweep), and
 *  - an EMPTY slot: the single BEST candidate equippable by the hero's class
 *    (your future first equip is kept; the other 97 copies go to the vendor).
 *    An empty slot must NOT keep everything (the original 0-baseline bug that
 *    warp-looped the bot) and must NOT keep nothing (selling your only weapon).
 */

import type { GearSlot, HeroClass, ItemRarity } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

export interface AutoSellRules {
  sellCommon: boolean;
  sellRare: boolean;
  /** Keep-guard: never sell a stat upgrade over what's equipped; on an empty
   * slot, keep the best class-equippable candidate (see module doc). */
  keepBetterStat: boolean;
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

/**
 * Selects instance ids to sell. NEVER selects an equipped item (belt-and-
 * braces — the server's sell endpoint rejects those anyway, `reason:
 * "equipped"`). A template missing from `templates` (stale/retired) is
 * skipped defensively rather than crashing the sweep. `heroClass` scopes the
 * empty-slot best-backup pick to items the hero can actually wear.
 */
export function selectAutoSellItemIds(
  items: readonly InventoryItem[],
  templates: Record<string, SellableTemplate>,
  rules: AutoSellRules,
  heroClass?: HeroClass,
): string[] {
  // Per-slot equipped stat-total baseline for the keep-guard.
  const equippedStatSum: Partial<Record<GearSlot, number>> = {};
  for (const item of items) {
    if (!item.equippedSlot) continue;
    const t = templates[item.templateId];
    if (t) equippedStatSum[item.equippedSlot] = statSum(t.stats);
  }

  // Empty-slot best-backup pick: the single strongest class-equippable
  // candidate per slot WITHOUT anything equipped (stat total, then tier, then
  // instanceId for a deterministic tie-break).
  const bestBackup: Partial<Record<GearSlot, string>> = {};
  if (rules.keepBetterStat) {
    for (const item of items) {
      if (item.equippedSlot !== null) continue;
      const t = templates[item.templateId];
      if (!t || equippedStatSum[t.slot] !== undefined) continue; // slot has gear
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
  }

  const out: string[] = [];
  for (const item of items) {
    if (item.equippedSlot !== null) continue; // never touch equipped gear
    const t = templates[item.templateId];
    if (!t) continue;
    if (t.rarity === "epic") continue; // v1: epic is never auto-sold, period
    if (t.rarity === "common" && !rules.sellCommon) continue;
    if (t.rarity === "rare" && !rules.sellRare) continue;
    if (rules.keepBetterStat) {
      const baseline = equippedStatSum[t.slot];
      // Slot has gear: keep only genuine upgrades. Empty slot: keep only the
      // best-backup pick (see module doc — never everything, never nothing).
      if (baseline !== undefined && statSum(t.stats) > baseline) continue;
      if (baseline === undefined && bestBackup[t.slot] === item.instanceId) continue;
    }
    out.push(item.instanceId);
  }
  return out;
}
