/**
 * M7.6 ตีบวก — the shared imperative salvage flow: POST `/api/items/salvage`,
 * then on success remove the salvaged instances from the `inventory` store
 * slice and queue the engine's `materialsDelta` intent with the server-
 * confirmed yield. Same "POST first, only mutate local state on success" rule
 * as `sellFlow.ts`'s `executeSell` (and the M7 equip flow) — `InventoryPanel.tsx`
 * (per-item + bulk salvage buttons) is the only caller today.
 *
 * Chunked to the server's per-request cap (mirrors `sellFlow.ts`'s doc — a
 * pre-cap character can hold far more than one batch's worth of junk gear).
 */

import { postSalvage } from "@/ui/gear/api";
import { useGameStore } from "@/ui/store/gameStore";

/** Mirrors `server/items.ts`'s `MAX_SALVAGE_BATCH` (server zone, not importable
 * from here — same deliberate duplication as `sellFlow.ts`'s `MAX_SELL_BATCH`). */
export const MAX_SALVAGE_BATCH = 100;

export interface SalvageFlowResult {
  ok: boolean;
  salvagedCount: number;
  totalMaterials: number;
}

export async function executeSalvage(itemIds: string[]): Promise<SalvageFlowResult> {
  if (itemIds.length === 0) return { ok: true, salvagedCount: 0, totalMaterials: 0 };

  let salvagedCount = 0;
  let totalMaterials = 0;
  for (let i = 0; i < itemIds.length; i += MAX_SALVAGE_BATCH) {
    const chunk = itemIds.slice(i, i + MAX_SALVAGE_BATCH);
    const res = await postSalvage(chunk);
    if (!res) return { ok: false, salvagedCount, totalMaterials }; // keep what already salvaged

    const store = useGameStore.getState();
    store.removeSalvagedFromInventory(res.results);
    if (res.totalMaterials > 0) store.creditMaterials(res.totalMaterials);
    salvagedCount += res.results.filter((r) => r.status === "salvaged").length;
    totalMaterials += res.totalMaterials;
  }
  return { ok: true, salvagedCount, totalMaterials };
}
