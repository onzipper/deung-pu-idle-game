/**
 * M7.6 ตีบวก — the shared imperative refine flow: POST `/api/items/refine`
 * (the SERVER rolls the attempt — the client never rolls, CLAUDE.md).
 *
 * Reveal redesign (owner: "ผลลัพธ์เผยตอนค้อนลงเท่านั้น"): the network result now
 * arrives EARLY relative to the hammer-strike choreography, so this module
 * deliberately splits "get the result" from "commit it to the store":
 *
 *  - `executeRefine` fires the POST and returns the server-confirmed outcome —
 *    it touches NO store state. `RefinePanel.tsx` stashes the result in its
 *    `refineReveal.ts` state machine's `held` value and keeps every visible
 *    number (gold, materials, item list, equipped stats) frozen until the
 *    final hammer strike lands.
 *  - `applyRefineResult` commits exactly that stash to the store — called by
 *    `RefinePanel.tsx` ONLY at the instant its reveal state machine transitions
 *    into `{ kind: "reveal" }`, never earlier. Materials/gold are SIGNED and
 *    ALWAYS consumed by an attempt regardless of outcome (even the "safe" +1-3
 *    band still spends the cost). On a non-destroying outcome the target
 *    instance's `refineLevel` is patched in place; on `destroyed` it's
 *    removed. Either way, if the item was EQUIPPED, the engine's `equip`
 *    intent is re-queued with the new state so the sim's applied stats stay in
 *    sync with the ledger — same "never let sim and server disagree" rule as
 *    the M7 equip flow.
 */

import { FORTIFIER_FOR_SLOT } from "@/engine";
import { postRefine } from "@/ui/gear/api";
import type { HeldRefineValues } from "@/ui/gear/refineReveal";
import { useGameStore } from "@/ui/store/gameStore";

export type RefineFlowResult =
  | (HeldRefineValues & {
      ok: true;
      cost: { materials: number; gold: number };
    })
  | { ok: false; reason: string };

/**
 * `useFortifier` (world-boss wave): guaranteed-success refine, consuming one
 * matching-slot "แกร่ง" fortifier server-side (same gold+materials cost as a
 * normal attempt — see `RefinePanel.tsx`'s fortify button). Pure network call —
 * no store mutation happens here (see module doc); `applyRefineResult` below
 * does that, deliberately deferred.
 */
export async function executeRefine(
  itemId: string,
  useFortifier = false,
): Promise<RefineFlowResult> {
  const res = await postRefine(itemId, useFortifier);
  if (!res.ok) return { ok: false, reason: res.reason };

  return {
    ok: true,
    outcomeKind: res.outcome,
    refineLevel: res.refineLevel,
    destroyed: res.destroyed,
    cost: res.cost,
    fortified: res.fortified,
    materialsDelta: res.materialsDelta,
    goldDelta: res.goldDelta,
  };
}

/**
 * Commits a previously-withheld `executeRefine` result to the store. `itemId`
 * must be the SAME instance id passed to `executeRefine`. The server doesn't
 * echo back WHICH fortifier instance it consumed (fortifiers are fungible, no
 * stat rolls), so on a fortified success this removes exactly ONE matching-slot
 * fortifier instance from the local inventory slice by templateId — any one is
 * as good as any other; the server-side ledger is the actual authority.
 */
export function applyRefineResult(itemId: string, held: HeldRefineValues): void {
  const store = useGameStore.getState();
  const before = store.inventory.find((i) => i.instanceId === itemId);

  if (held.materialsDelta) store.creditMaterials(held.materialsDelta);
  if (held.goldDelta) store.creditGold(held.goldDelta);

  if (held.destroyed) {
    store.removeInventoryInstance(itemId);
    if (before?.equippedSlot) store.queueEquip(before.equippedSlot, null);
  } else {
    store.setInventoryRefineLevel(itemId, held.refineLevel);
    if (before?.equippedSlot && before.templateId) {
      store.queueEquip(before.equippedSlot, before.templateId, held.refineLevel);
    }
  }

  if (held.fortified && before) {
    const fortId = FORTIFIER_FOR_SLOT[before.slot];
    const consumed = useGameStore.getState().inventory.find((i) => i.templateId === fortId);
    if (consumed) store.removeInventoryInstance(consumed.instanceId);
  }
}
