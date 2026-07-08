/**
 * "ตำราตำนาน" tome + legendary craft (endgame v1.2/v1.3) — the two POST-first
 * flows `AsuraTomePanel.tsx` calls. Same "POST first, mutate local state only
 * on success, queue the pure engine intent last" rule as
 * `ui/gear/refineFlow.ts`/`ui/gear/buybackFlow.ts`.
 */

import { postClaimAsuraSigil, postCraftLegendary } from "@/ui/asura/api";
import { postEquip } from "@/ui/gear/api";
import { applyEquipChange } from "@/ui/gear/inventoryOps";
import { useGameStore } from "@/ui/store/gameStore";

/** Every reason `/api/asura/sigil`'s contract defines, plus this layer's own
 * "network" — anything else collapses to "unknown" (same enumerated-not-probed
 * shape as `ui/gear/refineFlow.ts`'s `KNOWN_API_ERRORS`). */
const KNOWN_SIGIL_REASONS = new Set(["alreadyClaimed", "locked", "network"]);
/** Every reason `/api/asura/craft`'s contract defines (the engine's own
 * `craftBlockReason` ladder + the server's OWN weapon/ownership checks). */
const KNOWN_CRAFT_REASONS = new Set([
  "locked",
  "essence",
  "sigils",
  "stones",
  "gold",
  "materials",
  "weapon",
  "network",
]);

export type AsuraSigilFlowResult = { ok: true } | { ok: false; reason: string };

/** Claim today's daily z10 ตราอสูร sigil — the checklist panel's own claim
 * button. On success queues `craftLegendary`'s sibling `claimAsuraSigil`
 * intent (a plain add, engine-side); a 409 "already claimed today" is treated
 * the SAME as `ui/quest/dailyClaimFlow.ts`'s 409 branch — sync quietly, no
 * error surfaced (a stale double-tap or a cross-device claim). */
export async function executeClaimAsuraSigil(): Promise<AsuraSigilFlowResult> {
  const res = await postClaimAsuraSigil();
  if (res.ok) {
    useGameStore.getState().queueClaimAsuraSigil();
    return { ok: true };
  }
  if (res.reason === "alreadyClaimed") {
    useGameStore.getState().queueClaimAsuraSigil(); // sync quietly, same idempotent shape
    return { ok: true };
  }
  const reason = KNOWN_SIGIL_REASONS.has(res.reason) ? res.reason : "unknown";
  return { ok: false, reason };
}

export interface CraftLegendaryFlowResult {
  ok: boolean;
  reason?: string;
  /** The minted legendary's wire item (only present on success — the panel
   * uses this only for the fanfare toast's item name lookup). */
  item?: { templateId: string; instanceId: string };
}

/**
 * Sacrifice the t10 weapon at `instanceId` for the class legendary. On
 * success: merge the minted item into the local inventory slice, queue the
 * engine's `craftLegendary` intent (consumes essence/sigils/gold/materials
 * for the solo hero's own class), and auto-equip the new legendary (a second
 * POST — `postEquip` — since the item is fresh-owned, not yet in any slot;
 * the "success = fanfare toast + equip flow" spec). The equip step is
 * best-effort: an equip failure here does NOT undo the craft (the item is
 * already minted + in the bag either way) — the player can equip manually
 * from the inventory panel same as any drop.
 */
export async function executeCraftLegendary(instanceId: string): Promise<CraftLegendaryFlowResult> {
  const res = await postCraftLegendary(instanceId);
  const store = useGameStore.getState();

  if (!res.ok) {
    const reason = KNOWN_CRAFT_REASONS.has(res.reason) ? res.reason : "unknown";
    return { ok: false, reason };
  }

  store.mergeInventory([res.item]);
  store.queueCraftLegendary();

  const equipRes = await postEquip(res.item.id);
  if (equipRes.ok) {
    // Re-read the store (mergeInventory above already advanced it past the `store`
    // reference taken at the top of this function) so the equip patch applies onto
    // the freshly-merged inventory, not a stale pre-merge snapshot.
    const fresh = useGameStore.getState();
    fresh.setInventory(applyEquipChange(fresh.inventory, res.item.id, res.item.slot));
    fresh.queueEquip(res.item.slot, res.item.templateId, res.item.refineLevel);
  }

  return { ok: true, item: { templateId: res.item.templateId, instanceId: res.item.id } };
}
