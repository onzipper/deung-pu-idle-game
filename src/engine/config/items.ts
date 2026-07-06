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
  /**
   * Per-slot RO refine level (+0..+REFINE.maxRefine), M7.6 "ตีบวก" (SAVE v14).
   * OPTIONAL on the TYPE so pre-v14 constructions in the outer layers
   * (render/ui/server literals) still satisfy it without edits; the ENGINE's live
   * + persisted loadouts ALWAYS populate it, and every reader treats a missing
   * entry as +0 (no bonus) via `refineOf`. Server-authoritative — the engine
   * never ROLLS a refine (config/refine.ts); it only consumes the level into
   * stats/power (systems/stats `equip*Of`).
   */
  refine?: { weapon: number; armor: number };
}

/** An empty (nothing-equipped) loadout. */
export function emptyEquipped(): EquippedGear {
  return { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } };
}

/** The refine level of a loadout slot (missing/undefined → +0). */
export function refineOf(equipped: EquippedGear, slot: GearSlot): number {
  return equipped.refine?.[slot] ?? 0;
}

// ---------------------------------------------------------------------------
// Catalog (v1). Weapons carry pure ATK (per class); armor carries DEF + HP
// (mostly class-null, a few class-specific splits). Tiers band to the stage
// progression (s1..s15) via `tierForStage` below. All ids are ≤64 chars and
// FROZEN once shipped (DB instances reference them). Stat magnitudes are the
// SIM-SWEPT balance lever (docs/balance-m7.md) — the on-curve tier is ~+10-25%
// power; the tier-6 EPIC is the deliberate above-curve "break" reward.
// ---------------------------------------------------------------------------

/**
 * Per-tier weapon ATK (common baseline; the band-top weapon is epic). Tiers 7-10
 * (M7.9 "Grand Expansion", maps 4-6 / s16-30) CONTINUE the ~×1.3-1.4 geometric
 * step of t1-6 (22 → 30 → 40 → 53 → 70) so gear power tracks the steepening enemy
 * HP curve; t10 is the endgame ceiling (a t10+10 weapon is `70 × 1.8 = 126` atk).
 * First-pass numbers — the s16-30 rebalance wave tunes them.
 */
const WEAPON_ATK: Record<number, number> = {
  1: 3, 2: 5, 3: 8, 4: 11, 5: 15, 6: 22,
  7: 30, 8: 40, 9: 53, 10: 70,
};
/** Per-tier universal-armor [def, hp]. Tiers 1-6 (s1-15) are UNCHANGED (byte-identical
 * pre-s16 balance). M7.9 s16-30 rebalance (docs/balance-m79.md): t7-t10 def is ~2× the
 * first-pass values — armor DEF is FLAT per-hit mitigation (damage.ts `amount - def`),
 * so a bigger def directly counters the aggressive-belt death-spiral (many high-atk
 * hits) that walled the squishy classes, and is exactly the sanctioned "gear
 * contribution" survival lever for s16-30 (it can't touch s1-15 — that band wears
 * t1-6). HP eased up modestly in step. These are the tier-3 hero's survival scaling. */
const ARMOR_STATS: Record<number, [number, number]> = {
  1: [1, 20],
  2: [2, 35],
  3: [4, 55],
  4: [6, 85],
  5: [9, 130],
  6: [12, 190],
  7: [30, 300],
  8: [46, 430],
  9: [66, 760],
  10: [92, 1050],
};

function weapon(
  id: string,
  cls: HeroClass,
  tier: number,
  rarity: ItemRarity,
  atkOverride?: number,
): ItemTemplate {
  return {
    id,
    slot: "weapon",
    classReq: cls,
    tier,
    rarity,
    stats: { atk: atkOverride ?? WEAPON_ATK[tier] },
  };
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

  // ==== M7.9 "Grand Expansion" tiers 7-10 (maps 4-6, s16-30) ====
  // Same structure as t1-6: per-class weapons + universal armor, with ONE
  // class-specific flavour-split tier (t8, mirroring t4) and the band-top (t10)
  // as the endgame EPIC ceiling. Names theme to the maps (ice / desert / hell).
  // ---- swordsman weapons ----
  weapon("w_sword_t7_frost", "swordsman", 7, "rare"),
  weapon("w_sword_t8_dune", "swordsman", 8, "rare"),
  weapon("w_sword_t9_obsidian", "swordsman", 9, "rare"),
  weapon("w_sword_t10_apocalypse", "swordsman", 10, "epic"),
  // ---- archer weapons ----
  weapon("w_bow_t7_frost", "archer", 7, "rare"),
  weapon("w_bow_t8_dune", "archer", 8, "rare", 50),
  // M7.9 "Archer friction pass": t9/t10 bows carry a class-specific ATK PREMIUM over
  // the shared WEAPON_ATK curve (53/70). The archer's weak-mult small-radius arrow-rain
  // WOUNDS (not one-shots) deep-field clusters, waking survivor-retaliation that
  // attrition-kills it over its 1.5-2.4× clear times (s26-28 death spiral: 71/106/158).
  // A bigger flat bow ATK pushes each rain/storm drop OVER the s26-30 mob one-shot
  // threshold → fewer angry survivors → faster clear + far less soak. Class-locked
  // (classReq=archer) so sword/mage are byte-unchanged; t9/t10 drop only at s23+ so
  // s1-22 is byte-identical. Sim-tuned (docs/balance-m79.md "Archer friction pass").
  weapon("w_bow_t9_obsidian", "archer", 9, "rare", 85),
  weapon("w_bow_t10_apocalypse", "archer", 10, "epic", 115),
  // ---- mage weapons ----
  weapon("w_staff_t7_frost", "mage", 7, "rare"),
  weapon("w_staff_t8_dune", "mage", 8, "rare"),
  weapon("w_staff_t9_obsidian", "mage", 9, "rare"),
  weapon("w_staff_t10_apocalypse", "mage", 10, "epic"),
  // ---- universal armor ----
  armor("a_frost_t7_mail", 7, "rare", null),
  armor("a_dune_t8_plate", 8, "rare", null),
  armor("a_obsidian_t9_scale", 9, "rare", null),
  armor("a_infernal_t10_aegis", 10, "epic", null),
  // ---- class-specific armor (tier-8 flavour splits: tanky / mobile / caster) ----
  // M7.9 rebalance: t8 class splits keep their tanky/mobile/caster identity but their
  // def is lifted onto the new t8 flat-mitigation baseline (~46) — the sword split stays
  // the def-heavy pick, the archer/mage splits trade some def for their bigger HP pools.
  armor("a_sword_t8_bulwark", 8, "rare", "swordsman", [64, 290]),
  armor("a_archer_t8_stalker", 8, "rare", "archer", [34, 520]),
  armor("a_mage_t8_seer", 8, "rare", "mage", [30, 560]),
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

/**
 * The gear tier that is ON-CURVE for a given content stage. s1-15 (maps 1-3) is
 * UNCHANGED; M7.9 extends the bands through s30 (maps 4-6): t7 s16-18, t8 s19-22,
 * t9 s23-26, t10 s27-30. The bands intentionally straddle map boundaries (as t1-6
 * do), so a map's boss room can drop the band-top gear that seeds the next map.
 */
export function tierForStage(stage: number): number {
  if (stage <= 2) return 1;
  if (stage <= 5) return 2;
  if (stage <= 8) return 3;
  if (stage <= 10) return 4;
  if (stage <= 13) return 5;
  if (stage <= 15) return 6;
  if (stage <= 18) return 7;
  if (stage <= 22) return 8;
  if (stage <= 26) return 9;
  return 10; // s27-30 — the endgame band
}

/** The highest gear tier that exists in the catalog (M7.9 ceiling). */
export const MAX_TIER = 10;

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
  const next = Math.min(MAX_TIER, t + 1);
  const pool = next === t ? tierTemplates(t) : [...tierTemplates(t), ...tierTemplates(next)];
  return pool.map((tpl) => ({ templateId: tpl.id, chance: BOSS_WEIGHT[tpl.rarity] }));
}

/**
 * NPC vendor sell price in gold (M7.5 contract — server's sell endpoint imports
 * this; the ledger records the price in ItemEvent meta for future re-derivation).
 * Town-only selling is enforced engine/client-side, not here.
 *
 * TUNED (M7.5, docs/balance-m7.md "vendor price"): `round(tier^2 * rarityMult)`
 * with rarityMult {common 1, rare 1.5, epic 2.5}. Sized so a full 100-slot sell of
 * on-curve drops is a SMALL-but-felt ~3-14% of the kill gold earned over the time
 * it takes to fill the inventory at that stage band (mid/late bands land ~10-14%;
 * early bands are lower). Potions (stage-scaled, thousands per restock) stay the
 * dominant gold sink. Monotonic in tier; the epic break-tier sells the highest.
 * The ~4x cut from the placeholder (was `3 * tier^2 * {1,2,4}`) is what pulls sell
 * income down from ~64% of kill gold to this minor share.
 */
export function vendorPriceForTemplate(templateId: string): number {
  const t = ITEM_TEMPLATES[templateId];
  if (!t) return 0;
  const rarityMult = t.rarity === "epic" ? 2.5 : t.rarity === "rare" ? 1.5 : 1;
  return Math.round(t.tier * t.tier * rarityMult);
}

/** M7.5 inventory cap (instances per character) — bot sell-trip trigger + the
 * server-side claim backstop both read this. */
export const INVENTORY_CAP = 100;

/**
 * Server plausibility guard: the max summed per-kill FARM drop chance across any
 * stage — used to cap accepted claims per elapsed playtime. Computed HONESTLY
 * from the live tables (self-maintaining when the catalog changes). Boss drops
 * are a separate, infrequent guaranteed-one event and are not folded in here.
 */
export function maxSummedDropChance(): number {
  let max = 0;
  // Scans the full stage range (s1-30 since M7.9) so the guard tracks the densest
  // band's summed chance honestly as the catalog grows.
  for (let stage = 1; stage <= 30; stage++) {
    const sum = dropTableForStage(stage).reduce((acc, e) => acc + e.chance, 0);
    if (sum > max) max = sum;
  }
  return max;
}
