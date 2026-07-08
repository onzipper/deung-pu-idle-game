/**
 * Derived hero stats — the single place hero power is computed.
 *
 * M5 Character Pivot removed the purchasable upgrade lines; M5 "Base stats" then
 * split a hero's power across three axes:
 *   1. per-hero LEVEL (innate atk/hp growth),
 *   2. allocated BASE STATS (str/dex/int/vit — the player's choices), and
 *   3. class-evolution TIER (a permanent multiplier),
 * layered on the class base stats in `HERO_TYPES`.
 *
 * A class's DAMAGE scales off its PRIMARY stat only (sword=str, archer=dex,
 * mage=int — see `PRIMARY_STAT`). Two effects are UNIVERSAL: dex adds a small
 * attack-speed factor, vit adds max HP. Every stat bonus is measured from the
 * amount ALLOCATED ABOVE the class base (`CONFIG.stats.base`), so a fresh,
 * unallocated hero sits exactly on its class baseline (level 1 = 1.0, float-exact).
 *
 * The low-level functions take explicit stat values (defaulting to the class base
 * = no bonus); the `*Of(hero)` wrappers read the live hero's allocated stats.
 * `combatPower(hero)` is the single "พลังต่อสู้" scalar (HOF metric + boss hint).
 */

import { CONFIG, HERO_TYPES, PRIMARY_STAT, SKILL_TYPES } from "@/engine/config";
import { lookupTemplate, refineOf } from "@/engine/config/items";
import type { EquippedGear } from "@/engine/config/items";
import { refinedStat } from "@/engine/config/refine";
import type { Hero, HeroClass, HeroStats, StatKey } from "@/engine/entities";

const ST = CONFIG.stats;
const MN = CONFIG.mana;

/** A fresh copy of the class's starting stat block (mutable — safe to assign). */
export function baseStats(cls: HeroClass): HeroStats {
  return { ...ST.base[cls] };
}

/** The class's primary (damage-scaling) stat / auto-allocate target. */
export function primaryStat(cls: HeroClass): StatKey {
  return PRIMARY_STAT[cls];
}

/**
 * Per-hero TIER multipliers (M5 class evolution + M7.9 tier 3). Tier 1 yields exactly
 * 1.0, so a non-evolved hero is unchanged. Tier 2 applies the permanent evolution
 * multipliers, compounding MULTIPLICATIVELY on top of the level + stat bonus. Tier 3
 * (M7.9 "Grand Expansion") compounds the tier-3 multiplier ON TOP of the tier-2 one
 * (tier2mult × tier3mult) — the designed power spike that breaks the s15 wall.
 */
export function tierAtkMult(tier: 1 | 2 | 3): number {
  if (tier >= 3) return CONFIG.evolution.atkMult * CONFIG.evolution.tier3.atkMult;
  return tier === 2 ? CONFIG.evolution.atkMult : 1;
}
export function tierHpMult(tier: 1 | 2 | 3): number {
  if (tier >= 3) return CONFIG.evolution.hpMult * CONFIG.evolution.tier3.hpMult;
  return tier === 2 ? CONFIG.evolution.hpMult : 1;
}

/**
 * Attack damage for a hero of class `cls`. `primaryValue` is the class's PRIMARY
 * stat value (defaults to the class base = no stat bonus). The level bonus and the
 * primary-stat bonus combine ADDITIVELY (the re-tune calibrates them so an
 * organically-levelled auto-allocated hero reproduces the pre-stats 0.10/level
 * total exactly); the tier multiplier then applies.
 */
export function heroAtk(
  cls: HeroClass,
  level = 1,
  tier: 1 | 2 | 3 = 1,
  primaryValue: number = ST.base[cls][PRIMARY_STAT[cls]],
): number {
  const allocPrimary = primaryValue - ST.base[cls][PRIMARY_STAT[cls]];
  const mult =
    1 + (level - 1) * CONFIG.leveling.atkPerLevel + allocPrimary * ST.atkPerPrimaryPoint;
  return Math.round(CONFIG.heroBaseAtk * HERO_TYPES[cls].dmgMult * mult * tierAtkMult(tier));
}

/**
 * Seconds between attacks (lower = faster). `dexValue` (default = class base = no
 * bonus) applies the small universal dex atk-speed factor on top of the class base
 * cadence.
 */
export function heroAtkSpeed(
  cls: HeroClass,
  dexValue: number = ST.base[cls].dex,
): number {
  const allocDex = dexValue - ST.base[cls].dex;
  return HERO_TYPES[cls].atkSpeed / (1 + allocDex * ST.atkSpeedPerDexPoint);
}

/**
 * Max HP for a hero of class `cls`. `vitValue` (default = class base = no bonus)
 * adds the universal vit HP bonus. Per-class base HP (`HERO_TYPES.hpMult`) keeps
 * the tank/squishy identity (see config note on why it's NOT folded into vit).
 */
export function heroMaxHp(
  cls: HeroClass,
  level = 1,
  tier: 1 | 2 | 3 = 1,
  vitValue: number = ST.base[cls].vit,
): number {
  const allocVit = vitValue - ST.base[cls].vit;
  const mult = 1 + (level - 1) * CONFIG.leveling.hpPerLevel + allocVit * ST.hpPerVitPoint;
  return Math.round(CONFIG.heroBaseHp * HERO_TYPES[cls].hpMult * mult * tierHpMult(tier));
}

/**
 * Max mana for a hero of class `cls` (M5 "mana"). A flat class-independent base
 * plus a per-point bonus for INT ALLOCATED ABOVE the class base — so the mage
 * (primary = int, the auto-allocate target) grows a deep caster pool while the
 * str/dex classes sit on the flat base. `intValue` defaults to the class base
 * (= base pool, no bonus).
 */
export function heroMaxMana(
  cls: HeroClass,
  intValue: number = ST.base[cls].int,
  tier: 1 | 2 | 3 = 1,
): number {
  const allocInt = Math.max(0, intValue - ST.base[cls].int);
  // M7.9 tier-3 pool bonus: a flat bump so the grander skill-4 (cost ~120) is castable
  // yet gating (see config `mana.tier3PoolBonus`). Only tier 3 gets it.
  const tier3 = tier >= 3 ? MN.tier3PoolBonus : 0;
  return Math.round(MN.base + allocInt * MN.perIntPoint + tier3);
}

/**
 * Mana regenerated per SECOND (M5 "mana"). Base regen (sized to sustain each
 * class's signature cast — the idle guarantee) plus an INT-above-base bonus that
 * gives the mage the sustain to run several skills at once.
 */
export function heroManaRegen(cls: HeroClass, intValue: number = ST.base[cls].int): number {
  const allocInt = Math.max(0, intValue - ST.base[cls].int);
  return MN.baseRegen + allocInt * MN.regenPerIntPoint;
}

// ---------------------------------------------------------------------------
// Equipped-gear stat readers (M7). Flat additive on top of level/stat/tier.
// A no-gear hero (empty loadout) contributes exactly 0 on every axis, so an
// unarmored hero's combat math is byte-identical to pre-M7 (balance untouched).
// ---------------------------------------------------------------------------

function equipStatSum(equipped: EquippedGear, key: "atk" | "def" | "hp"): number {
  let sum = 0;
  // lookupTemplate (not a bare ITEM_TEMPLATES read) so a "ตำราตำนาน" legendary weapon resolves
  // its stat block — legendaries live in the SEPARATE catalog like fortifiers (gear count frozen).
  const w = equipped.weapon ? lookupTemplate(equipped.weapon) : undefined;
  const a = equipped.armor ? lookupTemplate(equipped.armor) : undefined;
  // M7.6 ตีบวก: each item's flat stat is scaled by its per-slot refine level
  // (+0 → ×1, so an unrefined loadout is byte-identical to pre-M7.6).
  if (w) sum += refinedStat(w.stats[key] ?? 0, refineOf(equipped, "weapon"));
  if (a) sum += refinedStat(a.stats[key] ?? 0, refineOf(equipped, "armor"));
  return sum;
}

/** Flat ATK from equipped gear (weapon + armor). 0 when nothing is equipped. */
export function equipAtkOf(h: Hero): number {
  return equipStatSum(h.equipped, "atk");
}
/** Flat DEF (per-hit flat mitigation) from equipped gear. 0 when unarmored. */
export function equipDefOf(h: Hero): number {
  return equipStatSum(h.equipped, "def");
}
/** Flat max-HP from equipped gear. 0 when unarmored. */
export function equipHpOf(h: Hero): number {
  return equipStatSum(h.equipped, "hp");
}

// ---------------------------------------------------------------------------
// Live-hero convenience wrappers (read the hero's allocated stats + gear).
// ---------------------------------------------------------------------------

/**
 * Base attack of a live hero (level + primary stat + tier + equipped weapon),
 * WITHOUT any transient self ATK buff. Used by the combat-power metric so the
 * HOF number doesn't flicker with a war-cry. Gear ATK is flat-additive.
 */
export function heroBaseAtkOf(h: Hero): number {
  return heroAtk(h.cls, h.level, h.tier, h.stats[PRIMARY_STAT[h.cls]]) + equipAtkOf(h);
}
/** Live attack INCLUDING the active self ATK buff (used by combat/skills). */
export function heroAtkOf(h: Hero): number {
  const base = heroBaseAtkOf(h);
  return h.atkBuffTimer > 0 ? Math.round(base * h.atkBuffMult) : base;
}
export function heroAtkSpeedOf(h: Hero): number {
  return heroAtkSpeed(h.cls, h.stats.dex);
}
export function heroMaxHpOf(h: Hero): number {
  return heroMaxHp(h.cls, h.level, h.tier, h.stats.vit) + equipHpOf(h);
}
export function heroMaxManaOf(h: Hero): number {
  return heroMaxMana(h.cls, h.stats.int, h.tier);
}
export function heroManaRegenOf(h: Hero): number {
  return heroManaRegen(h.cls, h.stats.int);
}

/**
 * Effective damage-per-cast multiplier of a class's skill, for the power metric.
 * Derived from `SKILL_TYPES` (no duplicated constant): the archer's ARROW RAIN is
 * `mult` per drop across `targets` drops, so its effective per-cast value is
 * `mult * targets`; the single-hit / self-AoE skills use `mult` directly.
 */
function skillEffectiveMult(cls: HeroClass): number {
  const sk = SKILL_TYPES[cls];
  return cls === "archer" ? sk.mult * sk.targets : sk.mult;
}

/**
 * Combat power ("พลังต่อสู้") — the single scalar for the Hall of Fame metric and
 * the boss-hint gauge. Combines EFFECTIVE DPS (basic attack + skill, so it no
 * longer under-reads the skill-heavy ranged classes that raw summed atk did) with
 * a survivability term from max HP. Non-decreasing in every stat point, level, and
 * tier (all weights are non-negative and each input term is monotonic).
 */
export function combatPower(h: Hero): number {
  const atk = heroBaseAtkOf(h);
  const basicDps = atk / heroAtkSpeedOf(h);
  const skillDps = (atk * skillEffectiveMult(h.cls)) / SKILL_TYPES[h.cls].cd;
  const offense = basicDps + skillDps;
  // heroBaseAtkOf + heroMaxHpOf already fold in equipped weapon/armor ATK/HP;
  // the flat DEF axis (per-hit mitigation) adds its own survivability term so
  // gear DEF shows up in the "พลังต่อสู้" scalar too. Monotonic (defWeight ≥ 0).
  return Math.round(
    offense * CONFIG.power.dpsWeight +
      heroMaxHpOf(h) * CONFIG.power.hpWeight +
      equipDefOf(h) * CONFIG.power.defWeight,
  );
}
