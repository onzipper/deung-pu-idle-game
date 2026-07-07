/**
 * M7.9 "no stacking" best -> worst inventory sort + the derived bulk-action id
 * pickers ("sell all common" / "salvage junk common"). Extracted out of
 * `InventoryPanel.tsx` (UAT: ShopPanel's sell/salvage tab reuse — CLAUDE.md's
 * "reuse, don't fork" rule) so both panels share EXACTLY one ranking/selection
 * definition. Pure TS, no React/fetch — headlessly testable.
 */

import { ITEM_TEMPLATES, refinedStat, type GearSlot, type ItemRarity, type ItemTemplate } from "@/engine";
import type { StatBlock } from "@/ui/gear/statDelta";
import type { InventoryItem } from "@/ui/gear/types";

/** The template's flat stat block, refined to `refineLevel` (M7.6 ตีบวก — a
 * +0 item is byte-identical to its base template). */
export function refinedStatsOf(template: ItemTemplate, refineLevel: number): StatBlock {
  return {
    atk: template.stats.atk ? refinedStat(template.stats.atk, refineLevel) : undefined,
    def: template.stats.def ? refinedStat(template.stats.def, refineLevel) : undefined,
    hp: template.stats.hp ? refinedStat(template.stats.hp, refineLevel) : undefined,
  };
}

/** Flat refined stat total (M7.6 ตีบวก) — used by the "salvage junk common"
 * bulk affordance to compare a candidate against what's equipped in its slot,
 * and (M7.9) as the last tie-break of the default inventory sort below. */
export function statSumOf(template: ItemTemplate, refineLevel: number): number {
  const s = refinedStatsOf(template, refineLevel);
  return (s.atk ?? 0) + (s.def ?? 0) + (s.hp ?? 0);
}

/** M7.9 "no stacking" default sort — BEST → WORST: tier desc, then refine
 * +level desc, then rarity (epic > rare > common) desc, then flat primary-stat
 * total desc. A missing/retired template sorts to the very bottom. */
const RARITY_RANK: Record<ItemRarity, number> = { epic: 2, rare: 1, common: 0 };

function inventorySortRank(item: InventoryItem): [number, number, number, number] {
  const template = ITEM_TEMPLATES[item.templateId];
  if (!template) return [-1, -1, -1, -1];
  return [
    template.tier,
    item.refineLevel,
    RARITY_RANK[template.rarity],
    statSumOf(template, item.refineLevel),
  ];
}

export function compareInventoryItems(a: InventoryItem, b: InventoryItem): number {
  const ra = inventorySortRank(a);
  const rb = inventorySortRank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return rb[i] - ra[i]; // descending
  }
  return 0;
}

/** Every UNEQUIPPED common instance id — the "sell all common" bulk button's
 * target set (shared by `InventoryPanel.tsx` and `ShopPanel.tsx`'s sell tab). */
export function sellAllCommonIds(inventory: readonly InventoryItem[]): string[] {
  return inventory
    .filter((i) => i.equippedSlot === null)
    .filter((i) => ITEM_TEMPLATES[i.templateId]?.rarity === "common")
    .map((i) => i.instanceId);
}

/** M7.6 ตีบวก bulk affordance: "ย่อยของ common ทั้งหมดที่ต่ำกว่าของที่ใส่" —
 * every UNEQUIPPED common item whose refined stat total does not beat what's
 * currently worn in its slot (an empty slot keeps everything eligible, same
 * as the sell-side keep-guard's "nothing worn yet" case). */
export function salvageJunkCommonIds(inventory: readonly InventoryItem[]): string[] {
  const equippedSumBySlot = new Map<GearSlot, number>();
  for (const it of inventory) {
    if (!it.equippedSlot) continue;
    const tpl = ITEM_TEMPLATES[it.templateId];
    if (tpl) equippedSumBySlot.set(it.equippedSlot, statSumOf(tpl, it.refineLevel));
  }
  return inventory
    .filter((i) => i.equippedSlot === null)
    .filter((i) => ITEM_TEMPLATES[i.templateId]?.rarity === "common")
    .filter((i) => {
      const tpl = ITEM_TEMPLATES[i.templateId];
      if (!tpl) return false;
      const baseline = equippedSumBySlot.get(tpl.slot);
      return baseline === undefined || statSumOf(tpl, i.refineLevel) <= baseline;
    })
    .map((i) => i.instanceId);
}
