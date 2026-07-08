/**
 * Equipment paper-doll — pure slot-model builder, extracted from
 * `EquipmentDoll.tsx` so "which instance is equipped where" is unit-testable
 * without mounting React (matches the pattern of `sortRank.ts`/`stacking.ts`).
 *
 * REAL slots (`weapon`/`armor`) mirror the engine's `GearSlot` catalog and
 * read the live inventory. TEASER slots are a display-only "coming soon" set
 * — no catalog entry exists for them, they are never persisted, and they
 * never carry an instance.
 */

import type { GearSlot } from "@/engine";
import type { InventoryItem } from "./types";

/** Fake, catalog-less slot ids for the "coming soon" ghosts (approved
 * paper-doll mockup). Order here is the desktop spatial order (top → bottom,
 * left → right within a row) — reused by the mobile flat-strip flatten too. */
export type TeaserSlotKey = "helmet" | "gloves" | "boots" | "amulet";

export const TEASER_SLOT_ORDER: readonly TeaserSlotKey[] = [
  "helmet",
  "gloves",
  "boots",
  "amulet",
];

/** Pre-2020 emoji only (Win10-safe — see CLAUDE.md footgun #4). */
export const TEASER_SLOT_ICONS: Record<TeaserSlotKey, string> = {
  helmet: "\u{1FA96}", // 🪖
  gloves: "\u{1F9E4}", // 🧤
  boots: "\u{1F462}", // 👢
  amulet: "\u{1F4FF}", // 📿
};

export interface DollRealSlot {
  kind: "real";
  slot: GearSlot;
  /** null when the slot is real but nothing is currently equipped there. */
  item: InventoryItem | null;
}

export interface DollTeaserSlot {
  kind: "teaser";
  key: TeaserSlotKey;
}

/** Find the instance (if any) equipped in a given real slot. Pure lookup —
 * at most one instance should ever match (equip flow enforces this), the
 * first hit is returned defensively. */
export function findEquipped(
  inventory: readonly InventoryItem[],
  slot: GearSlot,
): InventoryItem | null {
  return inventory.find((i) => i.equippedSlot === slot) ?? null;
}

/** Builds the two REAL doll slots (weapon, armor) from the owned inventory.
 * Teaser slots need no builder — they are a static, item-less constant. */
export function buildRealDollSlots(
  inventory: readonly InventoryItem[],
): readonly [DollRealSlot, DollRealSlot] {
  return [
    { kind: "real", slot: "weapon", item: findEquipped(inventory, "weapon") },
    { kind: "real", slot: "armor", item: findEquipped(inventory, "armor") },
  ];
}
