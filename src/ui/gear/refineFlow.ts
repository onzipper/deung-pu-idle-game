/**
 * M7.6 ตีบวก — the shared imperative refine flow: POST `/api/items/refine`
 * (the SERVER rolls the attempt — the client never rolls, CLAUDE.md), then
 * apply the server-confirmed deltas to the local store: materials/gold are
 * SIGNED and ALWAYS consumed by an attempt regardless of outcome (even the
 * "safe" +1-3 band still spends the cost), so both deltas are applied whenever
 * present. On a non-destroying outcome (success/degrade/safe) the target
 * instance's `refineLevel` is patched in place; on `destroyed` it's removed.
 * Either way, if the item was EQUIPPED, the engine's `equip` intent is
 * re-queued with the new state (new refineLevel, or unequipped on destroy) so
 * the sim's applied stats stay in sync with the ledger — same "never let sim
 * and server disagree" rule as the M7 equip flow.
 *
 * `RefinePanel.tsx` is the only caller; it owns the anticipation/outcome JUICE
 * timing around this call (this module is pure network + store wiring, no
 * timers/animation state).
 */

import { FORTIFIER_FOR_SLOT } from "@/engine";
import { postRefine } from "@/ui/gear/api";
import type { RefineOutcome } from "@/ui/gear/types";
import { useGameStore } from "@/ui/store/gameStore";

export type RefineFlowResult =
  | {
      ok: true;
      outcome: RefineOutcome;
      refineLevel: number;
      destroyed: boolean;
      cost: { materials: number; gold: number };
      /** True when a "แกร่ง" fortifier was consumed for a guaranteed success —
       * `RefinePanel.tsx` plays distinct success juice/copy for it. */
      fortified: boolean;
    }
  | { ok: false; reason: string };

/**
 * `useFortifier` (world-boss wave): guaranteed-success refine, consuming one
 * matching-slot "แกร่ง" fortifier server-side (same gold+materials cost as a
 * normal attempt — see `RefinePanel.tsx`'s fortify button). The server doesn't
 * echo back WHICH fortifier instance it consumed (fortifiers are fungible, no
 * stat rolls), so on a fortified success this removes exactly ONE matching-slot
 * fortifier instance from the local inventory slice by templateId — any one is
 * as good as any other; the server-side ledger is the actual authority.
 */
export async function executeRefine(
  itemId: string,
  useFortifier = false,
): Promise<RefineFlowResult> {
  const before = useGameStore.getState().inventory.find((i) => i.instanceId === itemId);
  const res = await postRefine(itemId, useFortifier);
  if (!res.ok) return { ok: false, reason: res.reason };

  const store = useGameStore.getState();
  if (res.materialsDelta) store.creditMaterials(res.materialsDelta);
  if (res.goldDelta) store.creditGold(res.goldDelta);

  if (res.destroyed) {
    store.removeInventoryInstance(itemId);
    if (before?.equippedSlot) store.queueEquip(before.equippedSlot, null);
  } else {
    store.setInventoryRefineLevel(itemId, res.refineLevel);
    if (before?.equippedSlot && before.templateId) {
      store.queueEquip(before.equippedSlot, before.templateId, res.refineLevel);
    }
  }

  if (res.fortified && before) {
    const fortId = FORTIFIER_FOR_SLOT[before.slot];
    const consumed = useGameStore
      .getState()
      .inventory.find((i) => i.templateId === fortId);
    if (consumed) store.removeInventoryInstance(consumed.instanceId);
  }

  return {
    ok: true,
    outcome: res.outcome,
    refineLevel: res.refineLevel,
    destroyed: res.destroyed,
    cost: res.cost,
    fortified: res.fortified,
  };
}
