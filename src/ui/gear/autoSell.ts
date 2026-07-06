/**
 * M7.5 auto-sell rules — pure selection of which owned instances a sell-trip
 * (manual bulk button OR the bot's `townArrived` reason "sell"/"restockSell"
 * executor in `GameClient.tsx`) should sell. No React/fetch here (headlessly
 * testable, `__tests__/autoSell.test.ts`).
 *
 * Rules are v1 owner-locked (ROADMAP.md M7.5 task, decided 2026-07-06): epic
 * NEVER auto-sells (no `sellEpic` field — the rule doesn't exist, not just
 * defaulted off), common defaults ON, rare defaults OFF. `keepBetterStat`
 * ("เก็บของที่ stat ดีกว่าของที่ใส่") is an extra guard on top of the rarity
 * rule, never a sell trigger by itself.
 */

import type { GearSlot, ItemRarity } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

export interface AutoSellRules {
  sellCommon: boolean;
  sellRare: boolean;
  /** Keep-guard: never sell an item whose flat stat total beats what's
   * CURRENTLY EQUIPPED in that slot (a stat-upgrade survives the sweep even
   * if its rarity would otherwise qualify). */
  keepBetterStat: boolean;
}

/** The minimal per-template shape this module needs (a subset of the engine's
 * `ItemTemplate` — deliberately narrow so this stays testable without an
 * engine-config fixture). */
export interface SellableTemplate {
  rarity: ItemRarity;
  slot: GearSlot;
  stats: { atk?: number; def?: number; hp?: number };
}

function statSum(stats: SellableTemplate["stats"]): number {
  return (stats.atk ?? 0) + (stats.def ?? 0) + (stats.hp ?? 0);
}

/**
 * Selects instance ids to sell. NEVER selects an equipped item (belt-and-
 * braces — the server's sell endpoint rejects those anyway, `reason:
 * "equipped"`). A template missing from `templates` (stale/retired) is
 * skipped defensively rather than crashing the sweep.
 */
export function selectAutoSellItemIds(
  items: readonly InventoryItem[],
  templates: Record<string, SellableTemplate>,
  rules: AutoSellRules,
): string[] {
  // Per-slot equipped stat-total baseline for the keep-guard.
  const equippedStatSum: Partial<Record<GearSlot, number>> = {};
  for (const item of items) {
    if (!item.equippedSlot) continue;
    const t = templates[item.templateId];
    if (t) equippedStatSum[item.equippedSlot] = statSum(t.stats);
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
      const baseline = equippedStatSum[t.slot] ?? 0;
      if (statSum(t.stats) > baseline) continue; // keep: it beats what's worn
    }
    out.push(item.instanceId);
  }
  return out;
}
