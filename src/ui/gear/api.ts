/**
 * M7 Gear & Drops — thin `fetch` wrappers over the `/api/items/*` route handlers
 * (server zone, read-only from here). Same tier as `GameClient.tsx`'s own
 * `fetch("/api/save")` calls — plain client-side networking, not an engine
 * boundary violation (the engine is never touched from this module).
 */

import type { GearSlot } from "@/engine";
import type {
  BuybackApiResult,
  BuybackListItemWire,
  ClaimItemResultWire,
  ItemInstanceWire,
  RefineApiResult,
  SalvageItemResultWire,
  SellItemResultWire,
} from "@/ui/gear/types";

export interface InventoryFetchResult {
  items: ItemInstanceWire[];
  equipped: { weapon: string | null; armor: string | null };
  /** M7.5: non-deleted instance count + `INVENTORY_CAP` (server, `@/engine`
   * re-exports the same constant so the capacity bar never hardcodes a second
   * copy of the number). */
  count?: number;
  cap?: number;
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

/** POST /api/items/sell (M7.5). Returns `null` on a network/parse failure so
 * callers (manual sell button / the bot's auto-sell executor in `GameClient`)
 * can leave the local inventory slice untouched rather than risk a bad merge —
 * a retried sell is safe either way (the server's check-and-set is idempotent
 * per instance, see `server/items.ts`'s `sellItems` doc). */
export async function postSell(
  itemIds: string[],
): Promise<{ results: SellItemResultWire[]; totalGold: number } | null> {
  try {
    const res = await fetch("/api/items/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { results: SellItemResultWire[]; totalGold: number };
  } catch {
    return null;
  }
}

/** POST /api/items/salvage (M7.6 ตีบวก). Same "null on network failure, leave
 * local state untouched" contract as `postSell`. */
export async function postSalvage(
  itemIds: string[],
): Promise<{ results: SalvageItemResultWire[]; totalMaterials: number; materials: number } | null> {
  try {
    const res = await fetch("/api/items/salvage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      results: SalvageItemResultWire[];
      totalMaterials: number;
      materials: number;
    };
  } catch {
    return null;
  }
}

/** POST /api/items/refine (M7.6 ตีบวก) — the SERVER rolls the attempt (the
 * engine/client never rolls, CLAUDE.md). A non-2xx response (409 max/insufficient
 * funds, 404 not found) resolves to `{ ok: false, reason }` rather than
 * throwing, using the route's `code` field when present (falls back to `error`,
 * then `"unknown"`) — same shape as `postEquip`'s `EquipApiResult`. */
export async function postRefine(itemId: string): Promise<RefineApiResult> {
  try {
    const res = await fetch("/api/items/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const json = (await res.json()) as
      | Omit<Extract<RefineApiResult, { ok: true }>, "ok">
      | { error?: string; code?: string };
    if (!res.ok) {
      const reason =
        "code" in json && json.code
          ? json.code
          : "error" in json && json.error
            ? json.error
            : "unknown";
      return { ok: false, reason };
    }
    return { ok: true, ...(json as Omit<Extract<RefineApiResult, { ok: true }>, "ok">) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** GET /api/items/buyback (UAT "ซื้อคืน" buy-back) — already filtered to
 * this user, unexpired, unrestored, soonest-to-expire first. Returns `null`
 * on a network/parse failure so the tab can tell "genuinely empty" apart
 * from "couldn't load" (retry tap), same contract as `fetchInventory`. */
export async function fetchBuybackList(): Promise<{ items: BuybackListItemWire[] } | null> {
  try {
    const res = await fetch("/api/items/buyback", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as { items: BuybackListItemWire[] };
  } catch {
    return null;
  }
}

/** POST /api/items/buyback — re-purchase a sold item at the price it was
 * sold for. Same "non-2xx resolves to {ok:false,reason}, never throws" shape
 * as `postRefine`. */
export async function postBuyback(soldItemId: string): Promise<BuybackApiResult> {
  try {
    const res = await fetch("/api/items/buyback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soldItemId }),
    });
    const json = (await res.json()) as
      | { ok: true; goldDelta: number; item: ItemInstanceWire }
      | { ok?: false; reason?: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const reason = "reason" in json && json.reason ? json.reason : "unknown";
      return { ok: false, reason };
    }
    return json;
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Type-only re-export so components don't need a second import path. */
export type { GearSlot };
