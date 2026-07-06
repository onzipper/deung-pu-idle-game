/**
 * M7.5 Inventory UX overhaul — pure stack-grouping. Instances of the SAME
 * templateId AND refine +level are identical (no per-instance stat rolls, see
 * `docs/GDD.md`), so stacking by the compound `templateId:refineLevel` key is
 * lossless: every stack-level action (equip/sell/salvage/refine) just needs ONE
 * representative instance id out of the group. A +0 sword and a +5 sword of the
 * same template are DELIBERATELY separate stacks (M7.6 "ตีบวก") — different
 * effective stats, so they must render/act as distinct grid cells (see
 * `InventoryPanel.tsx`'s "+N" badge). No React/fetch here (headlessly testable,
 * `__tests__/stacking.test.ts`).
 */

import type { GearSlot } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

export interface ItemStack {
  templateId: string;
  slot: GearSlot;
  /** M7.6 ตีบวก — the refine +level shared by every instance in this stack. */
  refineLevel: number;
  /** Total owned instances of this template at this refine level. */
  count: number;
  /** One representative instance id for a stack-level action needing exactly
   * one id (an UNEQUIPPED instance when one exists, so a tap-to-equip/sell
   * never accidentally targets the one currently worn). */
  representativeId: string;
  /** The instance id currently equipped within this stack, or null (at most
   * one instance per templateId+refineLevel can be equipped — same slot, same
   * template, same level). */
  equippedInstanceId: string | null;
  /** Every instance id in the stack NOT currently equipped (equip/sell candidates). */
  unequippedIds: string[];
}

/** Groups owned instances by `templateId:refineLevel`. Order is insertion order
 * (first-seen bucket first) — callers sort (e.g. by tier, then refine level) as
 * a separate pure step. */
export function groupIntoStacks(items: readonly InventoryItem[]): ItemStack[] {
  const byKey = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = `${item.templateId}:${item.refineLevel}`;
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const stacks: ItemStack[] = [];
  for (const group of byKey.values()) {
    const equipped = group.find((i) => i.equippedSlot !== null) ?? null;
    const unequippedIds = group
      .filter((i) => i.equippedSlot === null)
      .map((i) => i.instanceId);
    stacks.push({
      templateId: group[0].templateId,
      slot: group[0].slot,
      refineLevel: group[0].refineLevel,
      count: group.length,
      representativeId: unequippedIds[0] ?? group[0].instanceId,
      equippedInstanceId: equipped?.instanceId ?? null,
      unequippedIds,
    });
  }
  return stacks;
}
