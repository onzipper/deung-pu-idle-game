/**
 * M7.5 Inventory UX overhaul — pure stack-grouping. Instances are identical v1
 * (no per-instance stat rolls, see `docs/GDD.md`), so stacking every owned
 * instance by `templateId` is lossless: every stack-level action (equip/sell)
 * just needs ONE representative instance id out of the group. No React/fetch
 * here (headlessly testable, `__tests__/stacking.test.ts`).
 */

import type { GearSlot } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

export interface ItemStack {
  templateId: string;
  slot: GearSlot;
  /** Total owned instances of this template. */
  count: number;
  /** One representative instance id for a stack-level action needing exactly
   * one id (an UNEQUIPPED instance when one exists, so a tap-to-equip/sell
   * never accidentally targets the one currently worn). */
  representativeId: string;
  /** The instance id currently equipped within this stack, or null (at most
   * one instance per templateId can be equipped — same slot, same template). */
  equippedInstanceId: string | null;
  /** Every instance id in the stack NOT currently equipped (equip/sell candidates). */
  unequippedIds: string[];
}

/** Groups owned instances by templateId. Order is insertion order (first-seen
 * template first) — callers sort (e.g. by tier) as a separate pure step. */
export function groupIntoStacks(items: readonly InventoryItem[]): ItemStack[] {
  const byTemplate = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const list = byTemplate.get(item.templateId);
    if (list) list.push(item);
    else byTemplate.set(item.templateId, [item]);
  }
  const stacks: ItemStack[] = [];
  for (const [templateId, group] of byTemplate) {
    const equipped = group.find((i) => i.equippedSlot !== null) ?? null;
    const unequippedIds = group
      .filter((i) => i.equippedSlot === null)
      .map((i) => i.instanceId);
    stacks.push({
      templateId,
      slot: group[0].slot,
      count: group.length,
      representativeId: unequippedIds[0] ?? group[0].instanceId,
      equippedInstanceId: equipped?.instanceId ?? null,
      unequippedIds,
    });
  }
  return stacks;
}
