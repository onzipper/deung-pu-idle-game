/**
 * M7 Gear & Drops — item-template catalog + per-stage drop tables.
 *
 * CONTRACT FILE (pinned by the orchestrator; both the engine drop-roll task
 * and the server claim/equip task build against these exports — extend freely,
 * do NOT rename the exported symbols/fields):
 *
 *  - `templateId` (= keys of ITEM_TEMPLATES) is the opaque string persisted in
 *    the DB's `ItemInstance.templateId` VARCHAR(64) (docs/persistence-m7.md).
 *    Stats live HERE in pure-TS config, never in the DB — balance tweaks must
 *    not migrate the DB. A shipped id is frozen forever (instances reference it).
 *  - The server imports this module directly (engine config is pure TS) to
 *    validate a drop claim: claimed template ∈ dropTableForStage(stage) /
 *    bossDropTableForStage(stage), plus a rate-plausibility cap built from
 *    `chance`.
 *  - Drop ROLLS are engine-side, deterministic and STATELESS: hashed from a
 *    persisted per-save monotonic loot counter — NEVER drawn from the wave-
 *    composition RNG stream (that stream is reserved; see CLAUDE.md).
 *  - Display names/desc are ui-side i18n (`items.${id}` keys in messages/*),
 *    never strings here.
 */

import type { HeroClass } from "../entities";

export type GearSlot = "weapon" | "armor";

export type ItemRarity = "common" | "rare" | "epic";

export interface ItemTemplate {
  /** Catalog key == ITEM_TEMPLATES map key == DB templateId. ≤64 chars. */
  id: string;
  slot: GearSlot;
  /** null = equippable by every class. */
  classReq: HeroClass | null;
  /** Power/visual tier — tier 3+ drives the M7 paper-doll sparkle/aura pass. */
  tier: number;
  rarity: ItemRarity;
  /** Flat additive stat block while equipped (extend cautiously; sim-swept). */
  stats: { atk?: number; def?: number; hp?: number };
}

/** Placeholder seed entries — the engine drop task owns fleshing this out per
 * class/tier/stage band (and MUST keep every id ≤64 chars, frozen once shipped). */
export const ITEM_TEMPLATES: Record<string, ItemTemplate> = {
  w_sword_t1_rusty: {
    id: "w_sword_t1_rusty",
    slot: "weapon",
    classReq: "swordsman",
    tier: 1,
    rarity: "common",
    stats: { atk: 2 },
  },
  a_cloth_t1_tunic: {
    id: "a_cloth_t1_tunic",
    slot: "armor",
    classReq: null,
    tier: 1,
    rarity: "common",
    stats: { def: 1, hp: 5 },
  },
};

export interface DropTableEntry {
  templateId: string;
  /** Per-kill drop probability in [0, 1]. */
  chance: number;
}

/** Farm-zone drop table for a global stage number (s1..s15 in balance docs). */
export function dropTableForStage(stage: number): DropTableEntry[] {
  void stage;
  return [];
}

/** Boss-room drop table (guaranteed-roll semantics are the engine task's call). */
export function bossDropTableForStage(stage: number): DropTableEntry[] {
  void stage;
  return [];
}

/** Server plausibility guard: the max summed per-kill drop chance across any
 * stage's table — used to cap accepted claims per elapsed playtime. */
export function maxSummedDropChance(): number {
  return 0.1;
}
