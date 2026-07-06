/**
 * M7 Gear & Drops — thin `fetch` wrappers over the `/api/items/*` route handlers
 * (server zone, read-only from here). Same tier as `GameClient.tsx`'s own
 * `fetch("/api/save")` calls — plain client-side networking, not an engine
 * boundary violation (the engine is never touched from this module).
 */

import type { GearSlot } from "@/engine";
import type { ClaimItemResultWire, ItemInstanceWire } from "@/ui/gear/types";

export interface InventoryFetchResult {
  items: ItemInstanceWire[];
  equipped: { weapon: string | null; armor: string | null };
}

/** GET /api/items — used for the equip-failure resync (and available for any
 * future manual refresh action). Returns `null` on a network/parse failure so
 * callers can leave the existing store slice untouched rather than clobber it. */
export async function fetchInventory(): Promise<InventoryFetchResult | null> {
  try {
    const res = await fetch("/api/items", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as InventoryFetchResult;
  } catch {
    return null;
  }
}

export type EquipApiResult =
  { ok: true; item: ItemInstanceWire } | { ok: false; reason: string };

async function postItemAction(url: string, itemId: string): Promise<EquipApiResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const json = (await res.json()) as
      { ok: true; item: ItemInstanceWire } | { error: string; code?: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const reason =
        "code" in json && json.code
          ? json.code
          : "error" in json
            ? json.error
            : "unknown";
      return { ok: false, reason };
    }
    return { ok: true, item: json.item };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** POST /api/items/equip. Server-validated (ownership, classReq, slot). */
export function postEquip(itemId: string): Promise<EquipApiResult> {
  return postItemAction("/api/items/equip", itemId);
}

/** POST /api/items/unequip. */
export function postUnequip(itemId: string): Promise<EquipApiResult> {
  return postItemAction("/api/items/unequip", itemId);
}

/** Batched POST /api/items/claim. Returns `null` on a network/parse failure so
 * the caller (GameClient's flush) can re-queue the batch for the next cadence
 * tick — the claim is idempotent server-side, so a retry is always safe. */
export async function postClaimBatch(
  items: { rollId: string; templateId: string; stage: number }[],
): Promise<{ results: ClaimItemResultWire[] } | null> {
  try {
    const res = await fetch("/api/items/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { results: ClaimItemResultWire[] };
  } catch {
    return null;
  }
}

/** Type-only re-export so components don't need a second import path. */
export type { GearSlot };
