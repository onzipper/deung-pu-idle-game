/**
 * M7.5 auto-equip (owner request 2026-07-06) — pure selection of which owned
 * instances the client should equip to keep the hero in its best gear. This is
 * the piece that closes the bot loop: drops land → the best piece gets WORN →
 * the auto-sell keep-guard's baseline rises → yesterday's gear stops being
 * "protected" and finally vendors on the next sell trip.
 *
 * Client-side like auto-sell (equipping is a server POST first, then the engine
 * `equip` intent — see `ui/README.md`'s equip-flow rule); this module is pure
 * and headlessly tested. Executor lives in `GameClient.tsx` (`performAutoEquip`).
 *
 * Rule per slot: among UNEQUIPPED, class-equippable candidates pick the best by
 * flat stat total (tier, then instanceId as deterministic tie-breaks) and equip
 * it iff the slot is EMPTY or it STRICTLY beats what's worn — never swap on a
 * tie (no churn: every swap is a server round trip + two ledger events).
 */

import type { GearSlot, HeroClass } from "@/engine";
import type { InventoryItem } from "@/ui/gear/types";
import type { SellableTemplate } from "@/ui/gear/autoSell";

export interface AutoEquipPick {
  instanceId: string;
  templateId: string;
  slot: GearSlot;
}

function statSum(stats: SellableTemplate["stats"]): number {
  return (stats.atk ?? 0) + (stats.def ?? 0) + (stats.hp ?? 0);
}

function equippableBy(t: SellableTemplate, cls: HeroClass | undefined): boolean {
  if (t.classReq === undefined || t.classReq === null) return true;
  return cls === undefined || t.classReq === cls;
}

/** Best strict-upgrade (or empty-slot fill) per gear slot; 0-2 picks. */
export function selectAutoEquip(
  items: readonly InventoryItem[],
  templates: Record<string, SellableTemplate>,
  heroClass?: HeroClass,
): AutoEquipPick[] {
  const wornSum: Partial<Record<GearSlot, number>> = {};
  for (const item of items) {
    if (!item.equippedSlot) continue;
    const t = templates[item.templateId];
    if (t) wornSum[item.equippedSlot] = statSum(t.stats);
  }

  const best: Partial<Record<GearSlot, { item: InventoryItem; t: SellableTemplate }>> = {};
  for (const item of items) {
    if (item.equippedSlot !== null) continue;
    const t = templates[item.templateId];
    if (!t || !equippableBy(t, heroClass)) continue;
    const cur = best[t.slot];
    const beats =
      !cur ||
      statSum(t.stats) > statSum(cur.t.stats) ||
      (statSum(t.stats) === statSum(cur.t.stats) &&
        ((t.tier ?? 0) > (cur.t.tier ?? 0) ||
          ((t.tier ?? 0) === (cur.t.tier ?? 0) && item.instanceId < cur.item.instanceId)));
    if (beats) best[t.slot] = { item, t };
  }

  const picks: AutoEquipPick[] = [];
  for (const slot of ["weapon", "armor"] as const) {
    const cand = best[slot];
    if (!cand) continue;
    const worn = wornSum[slot];
    if (worn !== undefined && statSum(cand.t.stats) <= worn) continue; // strict only
    picks.push({
      instanceId: cand.item.instanceId,
      templateId: cand.item.templateId,
      slot,
    });
  }
  return picks;
}
