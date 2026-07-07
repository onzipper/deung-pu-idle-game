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
  /** M7.6 ตีบวก RO-style refine +level (+0..+REFINE.maxRefine). Distinct
   * instances of the same templateId can sit at different levels — see
   * `ui/gear/stacking.ts`'s compound `templateId:refineLevel` grouping. */
  refineLevel: number;
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
  /** M7.6 ตีบวก (mirrors `server/items.ts`'s `ItemInstanceDTO.refineLevel`). */
  refineLevel: number;
}

export function toInventoryItem(dto: ItemInstanceWire): InventoryItem {
  return {
    instanceId: dto.id,
    templateId: dto.templateId,
    slot: dto.slot,
    equippedSlot: dto.equippedSlot,
    refineLevel: dto.refineLevel ?? 0,
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

/** One NPC-sell result, mirroring `server/items.ts`'s `SellItemResult` (M7.5).
 * "already" means the instance was already gone server-side (a stale local
 * copy — also worth dropping locally); "rejected" leaves the local item as-is
 * (still genuinely owned). */
export type SellItemResultWire =
  | { itemId: string; status: "sold"; price: number }
  | { itemId: string; status: "already"; price: 0 }
  | { itemId: string; status: "rejected"; reason: "equipped" | "not_found" };

/** One salvage result, mirroring `server/items.ts`'s `SalvageItemResult` (M7.6).
 * Same "already gone / rejected leaves it alone" shape as sell above. */
export type SalvageItemResultWire =
  | { itemId: string; status: "salvaged"; yield: number }
  | { itemId: string; status: "already"; yield: 0 }
  | { itemId: string; status: "rejected"; reason: "equipped" | "not_found" };

/** M7.6 ตีบวก refine outcome (mirrors `server/items.ts`'s `RefineOutcome`). */
export type RefineOutcome = "success" | "degrade" | "break" | "safe";

/** UAT "ซื้อคืน" buy-back — one re-purchasable sold-item entry, mirroring
 * `server/items.ts`'s buy-back record shape (GET /api/items/buyback): already
 * filtered to this user, unexpired, unrestored, soonest-to-expire first. */
export interface BuybackListItemWire {
  soldItemId: string;
  templateId: string;
  refineLevel: number;
  price: number;
  soldAt: string;
  expiresAt: string;
}

/** POST /api/items/buyback result (mirrors `postEquip`'s `EquipApiResult`
 * shape) — `reason` is a generic string here; `ui/gear/buybackFlow.ts`'s
 * `normalizeBuybackReason` narrows it to the known contract reasons
 * ("notFound" | "expired" | "insufficientGold" | "bagFull") for i18n lookup. */
export type BuybackApiResult =
  | { ok: true; goldDelta: number; item: ItemInstanceWire }
  | { ok: false; reason: string };

/** POST /api/items/refine success shape (mirrors `server/items.ts`'s
 * `RefineResult`'s `ok: true` branch). */
export interface RefineApiSuccess {
  ok: true;
  outcome: RefineOutcome;
  refineLevel: number;
  destroyed: boolean;
  materials: number;
  materialsDelta: number;
  goldDelta: number;
  cost: { materials: number; gold: number };
}

export type RefineApiResult = RefineApiSuccess | { ok: false; reason: string };
