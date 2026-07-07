/**
 * Multi-select sell helpers (owner request "ขาย item แบบเลือกหลายอัน",
 * เลือกหลายชิ้น) — pure, headlessly tested. `ShopPanel.tsx`'s sell tab is the
 * only consumer today (`SellRow.tsx` grew an optional select-mode, but
 * `InventoryPanel.tsx`'s grid never turns it on — smaller blast radius per the
 * feature brief). Kept separate from `sellFlow.ts` (which does the actual
 * POST/chunk-over-`MAX_SELL_BATCH` network flow) so the pure selection
 * bookkeeping stays independently testable from the fetch wrapper.
 */

import { vendorPriceForTemplate } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";

/** Toggle one instance id in/out of a selection list, preserving the order
 * items were selected in (not display order). */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** NPC vendor sell price for one instance. `vendorPriceForTemplate` is
 * refine-level-agnostic (engine/config/items.ts) so this is stable to show as
 * a running total while the player is still picking items — it's exactly what
 * the server will credit at sell time, not an estimate. */
export function sellPriceOf(item: Pick<InventoryItem, "templateId">): number {
  return vendorPriceForTemplate(item.templateId);
}

/** Summed sell price across a set of instances — the sticky action bar's
 * "💰{total}" figure. */
export function sumSellPrices(items: readonly Pick<InventoryItem, "templateId">[]): number {
  return items.reduce((sum, it) => sum + sellPriceOf(it), 0);
}
