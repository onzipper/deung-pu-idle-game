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

/**
 * A hero's equipped loadout (one weapon + one armor). Mirrors the server's
 * `EquippedLoadout` (src/server/items.ts) so the boot payload can drop straight
 * onto the engine hero. Stats resolve through `ITEM_TEMPLATES[templateId]`.
 * Persisted (SAVE v10) as a SIM CACHE — the DB `ItemInstance` ledger is
 * authoritative (docs/persistence-m7.md); the boot payload wins on load.
 */
export interface EquippedGear {
  weapon: string | null;
  armor: string | null;
}

/** An empty (nothing-equipped) loadout. */
export function emptyEquipped(): EquippedGear {
  return { weapon: null, armor: null };
}

// ---------------------------------------------------------------------------
// Catalog (v1). Weapons carry pure ATK (per class); armor carries DEF + HP
// (mostly class-null, a few class-specific splits). Tiers band to the stage
// progression (s1..s15) via `tierForStage` below. All ids are ≤64 chars and
// FROZEN once shipped (DB instances reference them). Stat magnitudes are the
// SIM-SWEPT balance lever (docs/balance-m7.md) — the on-curve tier is ~+10-25%
// power; the tier-6 EPIC is the deliberate above-curve "break" reward.
// ---------------------------------------------------------------------------

/** Per-tier weapon ATK (common baseline; the tier-6 weapon is epic). */
const WEAPON_ATK: Record<number, number> = { 1: 3, 2: 5, 3: 8, 4: 11, 5: 15, 6: 22 };
/** Per-tier universal-armor [def, hp]. */
const ARMOR_STATS: Record<number, [number, number]> = {
  1: [1, 20],
  2: [2, 35],
  3: [4, 55],
  4: [6, 85],
  5: [9, 130],
  6: [12, 190],
};

function weapon(
  id: string,
  cls: HeroClass,
  tier: number,
  rarity: ItemRarity,
): ItemTemplate {
  return { id, slot: "weapon", classReq: cls, tier, rarity, stats: { atk: WEAPON_ATK[tier] } };
}
function armor(
  id: string,
  tier: number,
  rarity: ItemRarity,
  classReq: HeroClass | null,
  override?: [number, number],
): ItemTemplate {
  const [def, hp] = override ?? ARMOR_STATS[tier];
  return { id, slot: "armor", classReq, tier, rarity, stats: { def, hp } };
}

const CATALOG: ItemTemplate[] = [
  // ---- swordsman weapons (str-scaling melee blades) ----
  weapon("w_sword_t1_rusty", "swordsman", 1, "common"),
  weapon("w_sword_t2_iron", "swordsman", 2, "common"),
  weapon("w_sword_t3_knight", "swordsman", 3, "rare"),
  weapon("w_sword_t4_flame", "swordsman", 4, "rare"),
  weapon("w_sword_t5_dragon", "swordsman", 5, "rare"),
  weapon("w_sword_t6_ragna", "swordsman", 6, "epic"),
  // ---- archer weapons (dex-scaling bows) ----
  weapon("w_bow_t1_short", "archer", 1, "common"),
  weapon("w_bow_t2_hunter", "archer", 2, "common"),
  weapon("w_bow_t3_composite", "archer", 3, "rare"),
  weapon("w_bow_t4_storm", "archer", 4, "rare"),
  weapon("w_bow_t5_phoenix", "archer", 5, "rare"),
  weapon("w_bow_t6_ragna", "archer", 6, "epic"),
  // ---- mage weapons (int-scaling staves) ----
  weapon("w_staff_t1_apprentice", "mage", 1, "common"),
  weapon("w_staff_t2_oak", "mage", 2, "common"),
  weapon("w_staff_t3_arcane", "mage", 3, "rare"),
  weapon("w_staff_t4_inferno", "mage", 4, "rare"),
  weapon("w_staff_t5_astral", "mage", 5, "rare"),
  weapon("w_staff_t6_ragna", "mage", 6, "epic"),
  // ---- universal armor (class-null: any class equips) ----
  armor("a_cloth_t1_tunic", 1, "common", null),
  armor("a_leather_t2_vest", 2, "common", null),
  armor("a_chain_t3_mail", 3, "rare", null),
  armor("a_plate_t4_guard", 4, "rare", null),
  armor("a_rune_t5_ward", 5, "rare", null),
  armor("a_aegis_t6_bulwark", 6, "epic", null),
  // ---- class-specific armor (tier-4 flavour splits: tanky / mobile / caster) ----
  armor("a_sword_t4_fortress", 4, "rare", "swordsman", [9, 65]),
  armor("a_archer_t4_windcloak", 4, "rare", "archer", [4, 105]),
  armor("a_mage_t4_archrobe", 4, "rare", "mage", [3, 125]),
];

/** The item catalog, keyed by templateId (== DB `ItemInstance.templateId`). */
export const ITEM_TEMPLATES: Record<string, ItemTemplate> = Object.fromEntries(
  CATALOG.map((t) => [t.id, t]),
);

// ---------------------------------------------------------------------------
// Drop tables — banded to the stage the mob was killed at.
// ---------------------------------------------------------------------------

export interface DropTableEntry {
  templateId: string;
  /** Per-kill drop probability in [0, 1] (a boss table treats it as a WEIGHT). */
  chance: number;
}

/** The gear tier that is ON-CURVE for a given content stage (s1..s15). */
export function tierForStage(stage: number): number {
  if (stage <= 2) return 1;
  if (stage <= 5) return 2;
  if (stage <= 8) return 3;
  if (stage <= 10) return 4;
  if (stage <= 13) return 5;
  return 6;
}

/** Per-rarity per-kill FARM drop chance (rarer bands drop less often). */
const FARM_CHANCE: Record<ItemRarity, number> = { common: 0.03, rare: 0.02, epic: 0.012 };
/** Per-rarity BOSS weight (guaranteed-roll → relative weights; boss = better odds). */
const BOSS_WEIGHT: Record<ItemRarity, number> = { common: 0.4, rare: 0.7, epic: 1.0 };

const TEMPLATES_BY_TIER = new Map<number, ItemTemplate[]>();
for (const t of CATALOG) {
  const list = TEMPLATES_BY_TIER.get(t.tier) ?? [];
  list.push(t);
  TEMPLATES_BY_TIER.set(t.tier, list);
}
function tierTemplates(tier: number): ItemTemplate[] {
  return TEMPLATES_BY_TIER.get(tier) ?? [];
}

/**
 * Farm-zone drop table for a global stage number (s1..s15). All items of the
 * stage's on-curve tier, each at its rarity's per-kill chance. Every class's
 * weapon is present (classReq gates equip, not the roll) plus the universal +
 * class armor of that tier.
 */
export function dropTableForStage(stage: number): DropTableEntry[] {
  return tierTemplates(tierForStage(stage)).map((t) => ({
    templateId: t.id,
    chance: FARM_CHANCE[t.rarity],
  }));
}

/**
 * Boss-room drop table for a global stage number. A boss is a GUARANTEED roll
 * (the engine always mints one item from this weighted pool — see
 * systems/gear.rollBossDrop): a richer pool of the boss's on-curve tier PLUS the
 * next tier up (capped at 6), weighted so the epic/next-tier lands more often
 * than a common. This is the milestone reward that seeds a player into the next
 * band's gear.
 */
export function bossDropTableForStage(stage: number): DropTableEntry[] {
  const t = tierForStage(stage);
  const next = Math.min(6, t + 1);
  const pool = next === t ? tierTemplates(t) : [...tierTemplates(t), ...tierTemplates(next)];
  return pool.map((tpl) => ({ templateId: tpl.id, chance: BOSS_WEIGHT[tpl.rarity] }));
}

/**
 * Server plausibility guard: the max summed per-kill FARM drop chance across any
 * stage — used to cap accepted claims per elapsed playtime. Computed HONESTLY
 * from the live tables (self-maintaining when the catalog changes). Boss drops
 * are a separate, infrequent guaranteed-one event and are not folded in here.
 */
export function maxSummedDropChance(): number {
  let max = 0;
  for (let stage = 1; stage <= 15; stage++) {
    const sum = dropTableForStage(stage).reduce((acc, e) => acc + e.chance, 0);
    if (sum > max) max = sum;
  }
  return max;
}
