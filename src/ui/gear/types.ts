/**
 * M7 Gear & Drops — UI-side shapes crossing the `/api/items/*` HTTP boundary.
 *
 * These mirror `src/server/items.ts`'s `ItemInstanceDTO`/`ClaimItemResult` JSON
 * shapes, NOT engine or server types (the UI never imports `@/server/**`) — a
 * network-boundary DTO is intentionally redeclared here rather than reached into.
 * `GearSlot` itself IS the shared engine type (`@/engine`), reused as-is since
 * it's the public catalog contract, not an internal.
 */

import type { GearSlot } from "@/engine";

/** One owned item instance, as carried in the UI's inventory store slice. */
export interface InventoryItem {
  instanceId: string;
  templateId: string;
  /** The template's gear slot (redundant with a catalog lookup, kept here so
   * the UI can group/render without depending on every templateId being a
   * known catalog entry — defensive against a stale client + newer catalog). */
  slot: GearSlot;
  /** Which slot it's CURRENTLY equipped in, or null. */
  equippedSlot: GearSlot | null;
}

/** The wire shape returned by GET /api/items and the `item` field of
 * equip/unequip/claim responses (mirrors `server/items.ts`'s `ItemInstanceDTO`). */
export interface ItemInstanceWire {
  id: string;
  templateId: string;
  slot: GearSlot;
  equippedSlot: GearSlot | null;
  origin: string;
  acquiredAt: string;
}

export function toInventoryItem(dto: ItemInstanceWire): InventoryItem {
  return {
    instanceId: dto.id,
    templateId: dto.templateId,
    slot: dto.slot,
    equippedSlot: dto.equippedSlot,
  };
}

/** One drop-claim result, mirroring `server/items.ts`'s `ClaimItemResult`. */
export type ClaimItemResultWire =
  | { status: "minted" | "existing"; item: ItemInstanceWire }
  | {
      status: "rejected";
      reason: "unknown_template" | "not_in_table" | "rate";
      rollId: string;
    };
