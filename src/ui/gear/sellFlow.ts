/**
 * M7.5 Sell UX — the shared imperative sell flow: POST `/api/items/sell`, then
 * on success remove the sold instances from the `inventory` store slice and
 * queue the engine's `goldCredit` intent with the server-confirmed total. Both
 * `InventoryPanel.tsx` (manual sell buttons) and `GameClient.tsx` (the bot's
 * auto-sell executor, triggered off a `townArrived` event) call this so the
 * "POST first, only mutate local state on success" rule (same shape as the
 * M7 equip flow) lives in exactly one place.
 */

import { postSell } from "@/ui/gear/api";
import { useGameStore } from "@/ui/store/gameStore";

export interface SellFlowResult {
  ok: boolean;
  soldCount: number;
  totalGold: number;
}

export async function executeSell(itemIds: string[]): Promise<SellFlowResult> {
  if (itemIds.length === 0) return { ok: true, soldCount: 0, totalGold: 0 };
  const res = await postSell(itemIds);
  if (!res) return { ok: false, soldCount: 0, totalGold: 0 };

  const store = useGameStore.getState();
  store.removeSoldFromInventory(res.results);
  if (res.totalGold > 0) store.creditGold(res.totalGold);

  const soldCount = res.results.filter((r) => r.status === "sold").length;
  return { ok: true, soldCount, totalGold: res.totalGold };
}
