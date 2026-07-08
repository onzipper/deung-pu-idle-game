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
import { REFINE, clampRefine } from "@/engine/config/refine";

export type GearSlot = "weapon" | "armor";

export type ItemRarity = "common" | "rare" | "epic";

export interface ItemTemplate {
  /** Catalog key == ITEM_TEMPLATES map key == DB templateId. ≤64 chars. */
  id: string;
  /** For "gear": the slot it equips into. For "fortifier": the gear slot it MATCHES
   *  (weapon-fortifier ↔ weapon gear) — a fortifier is never equipped into it. */
  slot: GearSlot;
  /** null = equippable by every class. Fortifiers are always null (no class gate). */
  classReq: HeroClass | null;
  /** Power/visual tier — tier 3+ drives the M7 paper-doll sparkle/aura pass. */
  tier: number;
  rarity: ItemRarity;
  /** Flat additive stat block while equipped (extend cautiously; sim-swept). */
  stats: { atk?: number; def?: number; hp?: number };
  /**
   * Item CATEGORY (world-boss wave). Absent/"gear" = a normal equippable gear
   * item (every pre-existing template — byte-identical). "fortifier" = a "แกร่ง"
   * consumable minted ONLY by the world-boss claim: NOT equippable, NOT NPC-sellable,
   * NOT in any drop table, and consumed by a GUARANTEED refine on a matching-slot gear
   * item (see src/server/items.ts `refineItem` useFortifier + src/server/worldBoss.ts).
   * `slot` is reused as the match key (fort_weapon.slot === "weapon"). The server layer
   * enforces the non-equippable/non-sellable rules; `tier: 0` also keeps fortifiers out
   * of every stage-banded drop table for free (tierForStage only ever returns 1..10).
   *
   * "legendary" = a "ตำราตำนาน" craft-only weapon (endgame v1.2/v1.3, docs/endgame-design.md).
   * Minted ONLY by the server on a `legendaryCraftRequested` (the tome craft), NEVER in any
   * drop table (`LEGENDARY_TIER` = 11 is above MAX_TIER so tierForStage can never band it) and
   * NEVER NPC-sellable. It IS an equippable weapon (unlike a fortifier) — equipItem admits kind
   * "legendary" and rejects only "fortifier". Its "awakening" (+0..+5, no-break) rides the
   * EXISTING per-slot refine field, capped per-kind by `maxRefineForTemplate` (LEGENDARY_MAX_
   * AWAKEN). Rarity stays "epic" (so the ui glow/sort `Record<ItemRarity>` maps need NO new
   * member — a deliberate non-breaking choice, exactly like the fortifiers' rarity "epic").
   */
  kind?: "gear" | "fortifier" | "legendary";
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
  weapon("w_bow_t8_dune", "archer", 8, "rare"),
  // M7.9 "Archer friction pass": t9/t10 bows carry a small class-specific ATK PREMIUM
  // over the shared WEAPON_ATK curve (53/70). The archer's frontier deaths are boss
  // wipes (its AoE storm scatters off a lone boss); flat bow ATK lifts its single-target
  // basic+powershot boss DPS. Class-locked (classReq=archer) so sword/mage are
  // byte-unchanged; t9/t10 drop only at s23+ so s1-22 is byte-identical.
  weapon("w_bow_t9_obsidian", "archer", 9, "rare", 66),
  weapon("w_bow_t10_apocalypse", "archer", 10, "epic", 88),
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

  // ==== Ninja "นินจา" dagger line t1-t10 (SAVE v18, docs/ninja-design.md §6) ====
  // A full 10-tier weapon line mirroring the sword/bow/staff structure (rarity band per
  // tier, t6/t10 EPIC), classReq "ninja". These are APPENDED to the catalog (like the M7.9
  // t7-10 block) and are CLASS-GATED OUT of every non-ninja drop table (DROP_GATED_CLASSES
  // below) — so the existing 3 classes' loot tables stay byte-identical (owner: "ผู้เล่นเดิม
  // กระทบน้อยสุด"). ATK curve = the SHARED WEAPON_ATK (identical to the sword's 3→5→8→…→70),
  // NO override. Rationale (documented per the wave brief): a ninja BASIC attack is the
  // dagger DOUBLE-HIT (`multiHit` 2 × `multiHitMult` 0.55 = 1.10× the rolled atk per swing,
  // HERO_TYPES.ninja), so at an equal weapon-ATK curve the ninja's effective per-swing ATK-
  // equivalent is 1.10 × swordATK = ~+10% over the sword AT EVERY TIER — landing squarely in
  // the design's "+10-15% DPS over sword" band (ninja-design §8), delivered THROUGH the
  // 2×0.55 basic (not baked as a raw number premium). The ninja's faster base cadence (0.45
  // vs sword 0.5) + DEX-driven atk-speed is its identity tax-offset for the shortest reach
  // (range 70) + thinner body (hpMult 1.15); the ninja SIM wave (5) owns the final trim of
  // those CLASS knobs, keeping this gear curve clean + parallel to the other three lines.
  weapon("w_dagger_t1_kunai", "ninja", 1, "common"),
  weapon("w_dagger_t2_tanto", "ninja", 2, "common"),
  weapon("w_dagger_t3_shadow", "ninja", 3, "rare"),
  weapon("w_dagger_t4_venom", "ninja", 4, "rare"),
  weapon("w_dagger_t5_wraith", "ninja", 5, "rare"),
  weapon("w_dagger_t6_ragna", "ninja", 6, "epic"),
  weapon("w_dagger_t7_frost", "ninja", 7, "rare"),
  weapon("w_dagger_t8_dune", "ninja", 8, "rare"),
  weapon("w_dagger_t9_obsidian", "ninja", 9, "rare"),
  weapon("w_dagger_t10_apocalypse", "ninja", 10, "epic"),
];

/** The GEAR catalog, keyed by templateId (== DB `ItemInstance.templateId`). Count is
 *  test-enforced ui-side (46 → 56 after the SAVE-v18 ninja dagger line; the ui i18n test
 *  owns that count + the `content.items.*` name keys, added in the ninja UI wave) —
 *  fortifiers are deliberately kept OUT of it (see FORTIFIER_TEMPLATES) so gear stays
 *  byte-identical. */
export const ITEM_TEMPLATES: Record<string, ItemTemplate> = Object.fromEntries(
  CATALOG.map((t) => [t.id, t]),
);

// ---------------------------------------------------------------------------
// World boss "เสี่ยจ๋อง" — "แกร่ง" fortifier consumables (SEPARATE catalog).
// ---------------------------------------------------------------------------
// Minted ONLY by the world-boss claim (50:50 crypto roll), NEVER dropped/sold/equipped.
// They are ItemInstances (not a counter) so a future marketplace can trade them. `slot`
// is the gear slot each one fortifies (the guaranteed-refine match key); tier 0 + empty
// stats keep them off every curve. Held in their OWN map (not ITEM_TEMPLATES / CATALOG) so
// the gear catalog's frozen count + drop tables are untouched; the server resolves an
// item instance's template via `lookupTemplate` (gear ∪ fortifier). Display name/desc are
// ui-side i18n (`items.fort_weapon` / `items.fort_armor`), never here.
export const FORTIFIER_TEMPLATES: Record<string, ItemTemplate> = {
  fort_weapon: { id: "fort_weapon", slot: "weapon", classReq: null, tier: 0, rarity: "epic", stats: {}, kind: "fortifier" },
  fort_armor: { id: "fort_armor", slot: "armor", classReq: null, tier: 0, rarity: "epic", stats: {}, kind: "fortifier" },
};

/** The "แกร่ง" fortifier templateId that matches (and guarantees a refine on) each gear
 *  slot — the single source both the world-boss mint and the guaranteed-refine match
 *  key read (weapon gear ↔ fort_weapon, armor gear ↔ fort_armor). */
export const FORTIFIER_FOR_SLOT: Record<GearSlot, string> = {
  weapon: "fort_weapon",
  armor: "fort_armor",
};

// ---------------------------------------------------------------------------
// "ตำราตำนาน" LEGENDARY weapons (endgame v1.2/v1.3 — craft-only, SEPARATE catalog).
// ---------------------------------------------------------------------------
// ONE weapon per class, minted ONLY by the server on the tome craft (never dropped/
// sold/salvaged). Held in their OWN map (not ITEM_TEMPLATES/CATALOG) so the frozen gear
// count (56, ui-test-enforced) + every drop table stay byte-identical — the FORTIFIER
// precedent. `LEGENDARY_TIER` = 11 (> MAX_TIER 10) keeps them off every stage band for
// free. Power ≈ class-t10 ATK × `LEGENDARY_ATK_MULT` (1.8, owner call 2026-07-08 — see below);
// "awakening" +0..+5 rides the existing refine field (refinedStat math, capped per-kind — see
// maxRefineForTemplate). Display name/desc are ui-side i18n (`items.<id>`), never here.
//
// OWNER CALL 2026-07-08 (v1.3 power-ceiling raise, "เดือดๆ"): LEGENDARY_ATK_MULT 1.4 → 1.8. Since
// `refinedStat(base, 10) === round(base * 1.8)`, the legendary's +0 base lands EXACTLY at t10+10
// parity (126 for the 70-base classes) — craft = instant parity with a maxed ordinary weapon.
//
// OWNER RETUNE 2026-07-08 (SUPERSEDES the +40% pass above): a fully-awakened legendary (+5) should
// sit at +80% over a t10+10, not +40%. Base stays at parity (LEGENDARY_ATK_MULT 1.8 UNCHANGED, +0 =
// 126 / bow 158). The reach comes from AWAKENING riding its OWN, steeper step — `LEGENDARY_AWAKEN_
// STEP` = 0.16 (16%/level) instead of the ordinary REFINE 8%. Then `1 + 5 × 0.16 = 1.8`, so a +5
// legendary's stat = base × 1.8 = (t10×1.8) × 1.8 = t10 × 3.24 ⇒ +5/+0 = ×1.8 = +80% over t10+10.
// Ordinary gear is UNTOUCHED (still 8%/step, `refinedStat`'s default) — normal-gear stat math +
// the canonical sim are byte-identical; only a kind === "legendary" item picks the 16% step (via
// `refineStepFor`). Deliberate earned-fantasy ceiling (legendary+5 trivializes asura's deeper
// zones) — flagged for the owner, not a bug.

/** The (above-ceiling) tier every legendary carries — keeps them out of tierForStage bands. */
export const LEGENDARY_TIER = 11;
/** ATK multiplier vs the class's t10 weapon (sim-sweepable balance lever, docs/endgame). Owner
 *  call 2026-07-08: 1.4 → 1.8 (base == t10+10 parity; see the block comment above). UNCHANGED by
 *  the +80% retune — the ceiling raise rides `LEGENDARY_AWAKEN_STEP`, not this base mult. */
export const LEGENDARY_ATK_MULT = 1.8;

/**
 * "สายปลุกพลัง" AWAKENING per-level stat step for a legendary (owner retune 2026-07-08). A
 * legendary's +N stat is `base × (1 + N × LEGENDARY_AWAKEN_STEP)` — 16%/level, DISTINCT from
 * ordinary gear's `REFINE.statBonusPerRefine` (8%). At the +5 cap this is `base × 1.8`, i.e. +80%
 * over the (already t10+10-parity) +0 base. `refinedStat` takes this as its `stepPercent` arg only
 * for kind === "legendary" items (see `refineStepFor`); every ordinary call keeps the 8% default,
 * so normal gear + the canonical sim stay byte-identical.
 */
export const LEGENDARY_AWAKEN_STEP = 0.16;

/**
 * The per-level refine/awaken stat STEP a template's stats climb by: a legendary uses its own
 * `LEGENDARY_AWAKEN_STEP` (16%), every other item (gear, fortifier, unknown) the ordinary
 * `REFINE.statBonusPerRefine` (8%). The SINGLE place item-kind maps to a refine step — every
 * stat reader (engine `equipStatSum`, the ui compare/stat lines) passes this into `refinedStat`
 * so a legendary's displayed + combat stats match its steeper awakening curve.
 */
export function refineStepFor(template: ItemTemplate | null | undefined): number {
  return template?.kind === "legendary" ? LEGENDARY_AWAKEN_STEP : REFINE.statBonusPerRefine;
}

function legendaryWeapon(id: string, cls: HeroClass, t10Atk: number): ItemTemplate {
  return {
    id,
    slot: "weapon",
    classReq: cls,
    tier: LEGENDARY_TIER,
    rarity: "epic",
    kind: "legendary",
    stats: { atk: Math.round(t10Atk * LEGENDARY_ATK_MULT) },
  };
}

/** Craft-only legendary weapons, keyed by templateId (== DB `ItemInstance.templateId`). t10 ATK
 *  per class: sword/mage/ninja 70 → 126, archer 88 (its class premium) → 158. FROZEN once shipped
 *  (the t10Atk INPUT, i.e. 70/88, is frozen — the derived legendary base scales with
 *  LEGENDARY_ATK_MULT, see the owner-call comment above). */
export const LEGENDARY_TEMPLATES: Record<string, ItemTemplate> = {
  w_legend_sword_emberfall: legendaryWeapon("w_legend_sword_emberfall", "swordsman", 70),
  w_legend_bow_starfall: legendaryWeapon("w_legend_bow_starfall", "archer", 88),
  w_legend_staff_runebind: legendaryWeapon("w_legend_staff_runebind", "mage", 70),
  w_legend_dagger_umbra: legendaryWeapon("w_legend_dagger_umbra", "ninja", 70),
};

/** The legendary weapon templateId crafted for each class (the tome recipe's output — the
 *  server mints THIS on `legendaryCraftRequested`; the engine emits it in the event). */
export const LEGENDARY_FOR_CLASS: Record<HeroClass, string> = {
  swordsman: "w_legend_sword_emberfall",
  archer: "w_legend_bow_starfall",
  mage: "w_legend_staff_runebind",
  ninja: "w_legend_dagger_umbra",
};

/** Whether `id` is a "ตำราตำนาน" legendary weapon (kind-tagged, so it is byte-distinct from a
 *  same-rarity epic). Used for the per-kind awakening cap + any legendary-only UI treatment. */
export function isLegendaryTemplate(id: string | null | undefined): boolean {
  return !!id && lookupTemplate(id)?.kind === "legendary";
}

/** The "ตำราตำนาน" AWAKENING ceiling (+0..+5, no-break) — a legendary's refine field is capped
 *  HERE, distinct from ordinary gear's REFINE.maxRefine (+10). Owner-locked (docs/endgame-design
 *  v1.2 "สายปลุกพลัง +0..+5"); as of the 2026-07-08 owner retune (LEGENDARY_AWAKEN_STEP 0.16) the
 *  +5 peak is +80% over a t10+10 (superseded the earlier +40% pass — see the items.ts block). */
export const LEGENDARY_MAX_AWAKEN = 5;

/** The max refine/awaken level a given template accepts: a legendary caps at LEGENDARY_MAX_AWAKEN
 *  (+5), all other gear at REFINE.maxRefine (+10). Unknown id → the ordinary ceiling. */
export function maxRefineForTemplate(id: string | null | undefined): number {
  return isLegendaryTemplate(id) ? LEGENDARY_MAX_AWAKEN : REFINE.maxRefine;
}

/** Clamp a server-decided refine/awaken `level` for a specific template: generic [0, maxRefine]
 *  first, then the template's per-kind ceiling (legendary +5). A null template → the generic clamp. */
export function clampRefineForTemplate(id: string | null | undefined, level: number | undefined): number {
  return Math.min(clampRefine(level), maxRefineForTemplate(id));
}

/**
 * "สายปลุกพลัง" AWAKENING cost to reach +targetLevel (1..LEGENDARY_MAX_AWAKEN) on a legendary:
 * escalating gold + เศษศิลา enhancement-stones. Awakening is 100% success and NEVER breaks
 * (owner design) — a pure, guaranteed materials/gold SINK, so there is no roll/degrade band like
 * ordinary refine. Server-debited (gold vs the save-blob balance MVP-gap, stones vs the
 * authoritative `Character.materials` column — the `refineItem` precedent). Exported as a
 * sweepable balance-knob table indexed by TARGET +level. Essence cost is DEFERRED (v1 gold+stones
 * only — no engine `awakenLegendary` intent exists yet; a future knob would add an essence count).
 */
export const AWAKEN_COST: Record<number, { gold: number; stones: number }> = {
  1: { gold: 100_000, stones: 250 },
  2: { gold: 250_000, stones: 500 },
  3: { gold: 500_000, stones: 1_000 },
  4: { gold: 900_000, stones: 1_800 },
  5: { gold: 1_500_000, stones: 3_000 },
};

/** Awakening cost (gold + stones) to reach `targetLevel` on a legendary, or null if out of the
 *  +1..+LEGENDARY_MAX_AWAKEN range (already at cap / bad input). Pure lookup — UI + server share it. */
export function awakenCost(targetLevel: number): { gold: number; stones: number } | null {
  return AWAKEN_COST[targetLevel] ?? null;
}

/** Resolve ANY item-instance template — gear OR fortifier OR legendary. Use this (not a bare
 *  `ITEM_TEMPLATES[id]`) wherever a persisted `ItemInstance.templateId` is turned back
 *  into a template, so fortifier/legendary instances resolve while the gear-only maps/tables stay
 *  fortifier/legendary-free. Returns undefined for a retired/unknown id. */
export function lookupTemplate(id: string): ItemTemplate | undefined {
  return ITEM_TEMPLATES[id] ?? FORTIFIER_TEMPLATES[id] ?? LEGENDARY_TEMPLATES[id];
}

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

/**
 * DROP-TABLE CLASS GATE (SAVE v18, ninja). A weapon line whose `classReq` is in this set
 * only enters a hero's drop CANDIDATE POOL when that hero IS that class — see `classAllows`.
 *
 * WHY only the new classes: the legacy sword/bow/staff lines have ALWAYS appeared in every
 * class's farm/boss table (`classReq` gated EQUIP, never the roll — a swordsman routinely
 * rolls an unusable bow). Adding the ninja daggers to those shared tables would shift the
 * deterministic loot-roll accumulator for the existing 3 classes (every kill's `r` band moves),
 * breaking byte-identical replay. Gating ONLY the daggers behind a class match keeps the three
 * legacy tables composition-IDENTICAL (daggers simply absent) while ninja rolls its own line —
 * the "least impact on existing players" policy (docs/ninja-design.md §6). Verified by the
 * gear tests (non-ninja table === pre-change table; a swordsman/archer/mage NEVER rolls a
 * dagger across thousands of kills) and the byte-identical canonical sim.
 *
 * NOTE (wave handoff): the drop-ROLL sites (systems/gear.ts rollEnemyDrop/rollBossDrop) call
 * `dropTableForStage(stage)` with NO class arg today, which resolves to the daggers-EXCLUDED
 * table for EVERYONE (the safe default that preserves byte-identity). For a NINJA hero to
 * actually roll daggers, the roll sites pass the roster's gated class — see
 * `gatedLootClass` in systems/gear.ts (wired in the same wave; end-to-end tested in
 * ninja.test.ts "dagger drop gating").
 */
export const DROP_GATED_CLASSES: ReadonlySet<HeroClass> = new Set<HeroClass>(["ninja"]);

/**
 * Is `t` allowed into a `heroClass` hero's drop candidate pool? A class-gated line
 * (DROP_GATED_CLASSES) is admitted ONLY to a matching-class hero; every legacy template
 * (including the other classes' weapons — historical behaviour) is admitted to everyone.
 * A missing/undefined `heroClass` (the legacy no-arg callers) admits NO gated line, so the
 * default table is byte-identical to the pre-ninja catalog.
 */
function classAllows(t: ItemTemplate, heroClass: HeroClass | null | undefined): boolean {
  if (t.classReq && DROP_GATED_CLASSES.has(t.classReq)) return heroClass === t.classReq;
  return true;
}

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
 * stage's on-curve tier, each at its rarity's per-kill chance. Every LEGACY class's
 * weapon is present (classReq gates equip, not the roll) plus the universal +
 * class armor of that tier. `heroClass` gates the class-locked NEW lines (ninja
 * daggers, DROP_GATED_CLASSES): omitted/non-matching → those are excluded, so the
 * table is byte-identical to the pre-ninja catalog for the existing 3 classes.
 */
export function dropTableForStage(
  stage: number,
  heroClass?: HeroClass | null,
): DropTableEntry[] {
  return tierTemplates(tierForStage(stage))
    .filter((t) => classAllows(t, heroClass))
    .map((t) => ({ templateId: t.id, chance: FARM_CHANCE[t.rarity] }));
}

/**
 * Boss-room drop table for a global stage number. A boss is a GUARANTEED roll
 * (the engine always mints one item from this weighted pool — see
 * systems/gear.rollBossDrop): a richer pool of the boss's on-curve tier PLUS the
 * next tier up (capped at 6), weighted so the epic/next-tier lands more often
 * than a common. This is the milestone reward that seeds a player into the next
 * band's gear.
 */
export function bossDropTableForStage(
  stage: number,
  heroClass?: HeroClass | null,
): DropTableEntry[] {
  const t = tierForStage(stage);
  const next = Math.min(MAX_TIER, t + 1);
  const pool = next === t ? tierTemplates(t) : [...tierTemplates(t), ...tierTemplates(next)];
  return pool
    .filter((tpl) => classAllows(tpl, heroClass))
    .map((tpl) => ({ templateId: tpl.id, chance: BOSS_WEIGHT[tpl.rarity] }));
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
  // band's summed chance honestly as the catalog grows. Scanned with the "ninja" class
  // so the class-gated dagger line is INCLUDED — a ninja's table is the SUPERSET (every
  // legacy line + its own daggers), i.e. the densest summed chance any hero can roll, so
  // the server claim cap stays honest for ninja. This only RAISES the cap; the existing 3
  // classes' actual rolls are byte-identical (daggers never enter their tables), so a
  // looser cap never rejects a legit non-ninja claim.
  for (let stage = 1; stage <= 30; stage++) {
    const sum = dropTableForStage(stage, "ninja").reduce((acc, e) => acc + e.chance, 0);
    if (sum > max) max = sum;
  }
  return max;
}
