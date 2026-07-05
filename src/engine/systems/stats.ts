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
import type { Hero, HeroClass, HeroStats, StatKey } from "@/engine/entities";

const ST = CONFIG.stats;

/** A fresh copy of the class's starting stat block (mutable — safe to assign). */
export function baseStats(cls: HeroClass): HeroStats {
  return { ...ST.base[cls] };
}

/** The class's primary (damage-scaling) stat / auto-allocate target. */
export function primaryStat(cls: HeroClass): StatKey {
  return PRIMARY_STAT[cls];
}

/**
 * Per-hero TIER multipliers (M5 class evolution). Tier 1 yields exactly 1.0, so a
 * non-evolved hero is unchanged. Tier 2 applies the permanent evolution
 * multipliers, compounding MULTIPLICATIVELY on top of the level + stat bonus.
 */
export function tierAtkMult(tier: 1 | 2): number {
  return tier === 2 ? CONFIG.evolution.atkMult : 1;
}
export function tierHpMult(tier: 1 | 2): number {
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
  tier: 1 | 2 = 1,
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
  tier: 1 | 2 = 1,
  vitValue: number = ST.base[cls].vit,
): number {
  const allocVit = vitValue - ST.base[cls].vit;
  const mult = 1 + (level - 1) * CONFIG.leveling.hpPerLevel + allocVit * ST.hpPerVitPoint;
  return Math.round(CONFIG.heroBaseHp * HERO_TYPES[cls].hpMult * mult * tierHpMult(tier));
}

// ---------------------------------------------------------------------------
// Live-hero convenience wrappers (read the hero's allocated stats).
// ---------------------------------------------------------------------------

export function heroAtkOf(h: Hero): number {
  return heroAtk(h.cls, h.level, h.tier, h.stats[PRIMARY_STAT[h.cls]]);
}
export function heroAtkSpeedOf(h: Hero): number {
  return heroAtkSpeed(h.cls, h.stats.dex);
}
export function heroMaxHpOf(h: Hero): number {
  return heroMaxHp(h.cls, h.level, h.tier, h.stats.vit);
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
  const atk = heroAtkOf(h);
  const basicDps = atk / heroAtkSpeedOf(h);
  const skillDps = (atk * skillEffectiveMult(h.cls)) / SKILL_TYPES[h.cls].cd;
  const offense = basicDps + skillDps;
  return Math.round(offense * CONFIG.power.dpsWeight + heroMaxHpOf(h) * CONFIG.power.hpWeight);
}
