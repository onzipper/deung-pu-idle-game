/**
 * "ปลุกพลัง" legendary AWAKENING flow (endgame v1.3) — the imperative
 * POST-first flow both `AsuraTomePanel.tsx` and the inventory `DetailCard`
 * call. Same rule as `ui/gear/refineFlow.ts`: POST `/api/asura/awaken` (the
 * SERVER debits stones + checks gold and guarantees the +1 — the client never
 * decides the outcome), then apply the server-confirmed signed deltas to the
 * local store (gold + materials are ALWAYS consumed on success) and patch the
 * instance's `refineLevel` in place. If the awakened item is EQUIPPED, re-queue
 * the engine's `equip` intent with the new +level so the sim's applied stats
 * stay in lockstep with the ledger — the same "never let sim and server
 * disagree" rule as the refine/equip flows.
 */

import { postAwakenLegendary } from "@/ui/asura/api";
import { useGameStore } from "@/ui/store/gameStore";

/** Every reason `/api/asura/awaken`'s contract defines, plus this layer's own
 * "network" — anything else collapses to "unknown" (the enumerated-not-probed
 * shape shared with `ui/asura/tomeFlow.ts`). */
const KNOWN_AWAKEN_REASONS = new Set([
  "not_found",
  "not_legendary",
  "max",
  "insufficient_gold",
  "insufficient_materials",
  "network",
]);

export type AwakenFlowResult =
  | { ok: true; refineLevel: number }
  | { ok: false; reason: string };

/**
 * Awaken (+1) the legendary at `instanceId`. On success: apply the signed
 * gold/materials deltas (engine intents), patch the instance's `refineLevel`,
 * and — if equipped — re-queue `equip` with the new +level. On failure returns
 * a narrowed reason for the caller's toast/copy.
 */
export async function executeAwakenLegendary(instanceId: string): Promise<AwakenFlowResult> {
  const before = useGameStore.getState().inventory.find((i) => i.instanceId === instanceId);
  const res = await postAwakenLegendary(instanceId);
  if (!res.ok) {
    const reason = KNOWN_AWAKEN_REASONS.has(res.reason) ? res.reason : "unknown";
    return { ok: false, reason };
  }

  const store = useGameStore.getState();
  if (res.goldDelta) store.creditGold(res.goldDelta);
  if (res.materialsDelta) store.creditMaterials(res.materialsDelta);
  store.setInventoryRefineLevel(instanceId, res.refineLevel);
  if (before?.equippedSlot && before.templateId) {
    store.queueEquip(before.equippedSlot, before.templateId, res.refineLevel);
  }

  return { ok: true, refineLevel: res.refineLevel };
}
