/**
 * M7 Gear & Drops — pure inventory-slice mutations + discovery-set derivation.
 * No React/fetch here (headlessly testable, `__tests__/inventoryOps.test.ts`).
 */

import type { GearSlot } from "@/engine";
import type {
  InventoryItem,
  ItemInstanceWire,
  SellItemResultWire,
} from "@/ui/gear/types";
import { toInventoryItem } from "@/ui/gear/types";

/**
 * Folds newly-claimed/fetched wire items into the local inventory slice,
 * ADDING any instance id not already present (never overwrites an existing
 * local row — the server is authoritative but a full refetch always replaces
 * wholesale via `replaceInventory` instead, so this merge-add is safe for the
 * claim-flush path specifically).
 */
export function mergeClaimedItems(
  items: readonly InventoryItem[],
  claimed: readonly ItemInstanceWire[],
): InventoryItem[] {
  if (claimed.length === 0) return items.slice();
  const byId = new Map(items.map((i) => [i.instanceId, i] as const));
  for (const dto of claimed) {
    if (!byId.has(dto.id)) byId.set(dto.id, toInventoryItem(dto));
  }
  return [...byId.values()];
}

/**
 * Applies a successful equip: the target item takes `slot`, and any OTHER
 * item that was occupying `slot` is displaced (mirrors the server's "unequip
 * the incumbent in the same tx" invariant — see `server/items.ts`).
 */
export function applyEquipChange(
  items: readonly InventoryItem[],
  instanceId: string,
  slot: GearSlot,
): InventoryItem[] {
  return items.map((i) => {
    if (i.instanceId === instanceId) return { ...i, equippedSlot: slot };
    if (i.equippedSlot === slot) return { ...i, equippedSlot: null };
    return i;
  });
}

/** Applies a successful unequip (idempotent — a not-equipped item is a no-op). */
export function applyUnequipChange(
  items: readonly InventoryItem[],
  instanceId: string,
): InventoryItem[] {
  return items.map((i) =>
    i.instanceId === instanceId ? { ...i, equippedSlot: null } : i,
  );
}

/**
 * Derived "ever discovered" template-id set for the codex collection grid —
 * v1 tradeoff (noted in `CodexPanel.tsx`/`src/ui/README.md`): this is simply
 * every templateId CURRENTLY owned, not a persisted "ever owned" ledger, so an
 * item destroyed/traded away in a future milestone would re-hide here. Good
 * enough until M9 trade/consume paths exist.
 */
export function discoveredTemplateIds(items: readonly InventoryItem[]): Set<string> {
  return new Set(items.map((i) => i.templateId));
}

/**
 * Applies a `/api/items/sell` batch result to the local inventory slice (M7.5).
 * Removes instances the server confirms are GONE — `"sold"` (this call sold
 * it) AND `"already"` (some earlier call already sold/deleted it; the local
 * copy is stale either way) — and leaves `"rejected"` items untouched (still
 * genuinely owned: equipped, or a not_found we don't otherwise act on).
 */
export function removeSoldItems(
  items: readonly InventoryItem[],
  results: readonly SellItemResultWire[],
): InventoryItem[] {
  const gone = new Set(
    results
      .filter((r) => r.status === "sold" || r.status === "already")
      .map((r) => r.itemId),
  );
  if (gone.size === 0) return items.slice();
  return items.filter((i) => !gone.has(i.instanceId));
}

/**
 * NEW-badge derivation (M7.5 inventory grid): a templateId not present in the
 * session's baseline set (captured once at boot — see `GameClient.tsx`'s
 * `setSessionKnownTemplateIds` call) is "new this session" for the WHOLE
 * session (never re-hidden mid-session, so the badge doesn't flicker in and
 * out as the player re-opens the panel).
 */
export function isNewTemplate(
  templateId: string,
  sessionKnownTemplateIds: readonly string[],
): boolean {
  return !sessionKnownTemplateIds.includes(templateId);
}
