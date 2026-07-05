/**
 * Derived hero stats — the single place hero power is computed.
 *
 * M5 Character Pivot: the three purchasable upgrade lines (atk/speed/hp) are
 * GONE (gold's sinks move to NPC potions / the marketplace in M6-M7). A hero's
 * power now comes purely from its per-hero LEVEL and class-evolution TIER,
 * layered on the class base stats in `HERO_TYPES`. These are the pure
 * `heroAtk` / `heroAtkSpeed` / `heroMaxHp` functions consumed by combat.
 */

import { CONFIG, HERO_TYPES } from "@/engine/config";
import type { HeroClass } from "@/engine/entities";

/**
 * Per-hero LEVEL multipliers (M5). Level 1 yields exactly 1.0 (float-exact), so a
 * fresh hero sits on its class base stat. With the upgrade lines removed, levels
 * are the primary interim power axis, so these carry real growth (see CONFIG).
 */
export function levelAtkMult(level: number): number {
  return 1 + (level - 1) * CONFIG.leveling.atkPerLevel;
}
export function levelHpMult(level: number): number {
  return 1 + (level - 1) * CONFIG.leveling.hpPerLevel;
}

/**
 * Per-hero TIER multipliers (M5 class evolution). Tier 1 yields exactly 1.0, so a
 * non-evolved hero is unchanged. Tier 2 applies the permanent evolution
 * multipliers, compounding MULTIPLICATIVELY on top of the per-level bonus.
 */
export function tierAtkMult(tier: 1 | 2): number {
  return tier === 2 ? CONFIG.evolution.atkMult : 1;
}
export function tierHpMult(tier: 1 | 2): number {
  return tier === 2 ? CONFIG.evolution.hpMult : 1;
}

/**
 * Attack damage for a hero of class `cls` at the given `level` and `tier` (both
 * default to base = level 1 / tier 1 = no bonus).
 */
export function heroAtk(cls: HeroClass, level = 1, tier: 1 | 2 = 1): number {
  return Math.round(
    CONFIG.heroBaseAtk *
      HERO_TYPES[cls].dmgMult *
      levelAtkMult(level) *
      tierAtkMult(tier),
  );
}

/** Seconds between attacks (lower = faster). Fixed per class (no speed line). */
export function heroAtkSpeed(cls: HeroClass): number {
  return HERO_TYPES[cls].atkSpeed;
}

/**
 * Max HP for a hero of class `cls` at the given `level` and `tier`. Per-class base
 * HP (`HERO_TYPES.hpMult`) lets tanky/squishy classes differ; per-hero because
 * levels and tiers differ per hero.
 */
export function heroMaxHp(cls: HeroClass, level = 1, tier: 1 | 2 = 1): number {
  return Math.round(
    CONFIG.heroBaseHp * HERO_TYPES[cls].hpMult * levelHpMult(level) * tierHpMult(tier),
  );
}
