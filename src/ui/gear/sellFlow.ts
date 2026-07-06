/**
 * M7.5 Sell UX — the shared imperative sell flow: POST `/api/items/sell`, then
 * on success remove the sold instances from the `inventory` store slice and
 * queue the engine's `goldCredit` intent with the server-confirmed total. Both
 * `InventoryPanel.tsx` (manual sell buttons) and `GameClient.tsx` (the bot's
 * auto-sell executor, triggered off a `townArrived` event) call this so the
 * "POST first, only mutate local state on success" rule (same shape as the
 * M7 equip flow) lives in exactly one place.
 *
 * Batches are CHUNKED to the server's per-request cap and posted sequentially
 * (2026-07-06 fix: a pre-cap character held 1,890 items — the 1,880-id sweep
 * exceeded the zod max(100) and the whole request 400'd, so the bot "sold
 * nothing" silently). Store state + gold are applied PER CHUNK, so a network
 * failure mid-sweep keeps everything already sold; the remainder just retries
 * on the next trip (server-side idempotent per instance).
 */

import { postSell } from "@/ui/gear/api";
import { useGameStore } from "@/ui/store/gameStore";

/** Mirrors `server/items.ts`'s `MAX_SELL_BATCH` (server zone, not importable
 * from here — a plain contract number, duplicated deliberately, same rule as
 * `GameClient.tsx`'s `MAX_CLAIM_BATCH`). */
export const MAX_SELL_BATCH = 100;

export interface SellFlowResult {
  ok: boolean;
  soldCount: number;
  totalGold: number;
}

export async function executeSell(itemIds: string[]): Promise<SellFlowResult> {
  if (itemIds.length === 0) return { ok: true, soldCount: 0, totalGold: 0 };

  let soldCount = 0;
  let totalGold = 0;
  for (let i = 0; i < itemIds.length; i += MAX_SELL_BATCH) {
    const chunk = itemIds.slice(i, i + MAX_SELL_BATCH);
    const res = await postSell(chunk);
    if (!res) return { ok: false, soldCount, totalGold }; // keep what already sold

    const store = useGameStore.getState();
    store.removeSoldFromInventory(res.results);
    if (res.totalGold > 0) store.creditGold(res.totalGold);
    soldCount += res.results.filter((r) => r.status === "sold").length;
    totalGold += res.totalGold;
  }
  return { ok: true, soldCount, totalGold };
}
