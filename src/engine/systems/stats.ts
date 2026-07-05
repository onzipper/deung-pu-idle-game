/**
 * Derived hero stats — the single place upgrades feed into combat.
 *
 * These are the POC's `heroAtk` / `heroAtkSpeed` / `heroMaxHp` functions, made
 * pure by taking the upgrade levels explicitly instead of reading a global.
 * This is the upgrade-modifier extension point: Phase B's buy/auto-upgrade only
 * needs to change `Upgrades` levels — every stat consumer already routes here.
 */

import { CONFIG, HERO_TYPES, UPGRADES, SPEED_UPGRADE_CAP } from "@/engine/config";
import type { HeroClass } from "@/engine/entities";

/** Upgrade levels per stat line. */
export interface Upgrades {
  atk: number;
  speed: number;
  hp: number;
}

/**
 * Per-hero LEVEL multipliers (M5). Levels compound MULTIPLICATIVELY with the
 * upgrade lines. Level 1 yields exactly 1.0 (float-exact), so an un-levelled hero
 * is bit-identical to the pre-M5 stat — every existing call site that omits
 * `level` keeps its old value.
 */
export function levelAtkMult(level: number): number {
  return 1 + (level - 1) * CONFIG.leveling.atkPerLevel;
}
export function levelHpMult(level: number): number {
  return 1 + (level - 1) * CONFIG.leveling.hpPerLevel;
}

/**
 * Per-hero TIER multipliers (M5 class evolution). Tier 1 yields exactly 1.0
 * (float-exact), so a non-evolved hero is bit-identical to the pre-evolution stat
 * — every call site that omits `tier` keeps its old value. Tier 2 applies the
 * permanent evolution multipliers, compounding MULTIPLICATIVELY on top of the
 * upgrade lines AND the per-level bonus.
 */
export function tierAtkMult(tier: 1 | 2): number {
  return tier === 2 ? CONFIG.evolution.atkMult : 1;
}
export function tierHpMult(tier: 1 | 2): number {
  return tier === 2 ? CONFIG.evolution.hpMult : 1;
}

/**
 * Attack damage for a hero of class `cls` at the given upgrade levels, hero
 * `level`, and `tier` (both default to the base value = no bonus, preserving
 * pre-M5 behaviour).
 */
export function heroAtk(cls: HeroClass, up: Upgrades, level = 1, tier: 1 | 2 = 1): number {
  return Math.round(
    CONFIG.heroBaseAtk *
      (1 + up.atk * UPGRADES.atk.per) *
      HERO_TYPES[cls].dmgMult *
      levelAtkMult(level) *
      tierAtkMult(tier),
  );
}

/** Seconds between attacks (lower = faster). Only the speed line is capped. */
export function heroAtkSpeed(cls: HeroClass, up: Upgrades): number {
  const spd = Math.min(up.speed, SPEED_UPGRADE_CAP);
  return HERO_TYPES[cls].atkSpeed / (1 + spd * UPGRADES.speed.per);
}

/**
 * Max HP for a hero at the given upgrade levels, hero `level`, and `tier` (both
 * default to the base value = no bonus). Per-hero (not shared) because levels and
 * tiers differ per hero.
 */
export function heroMaxHp(up: Upgrades, level = 1, tier: 1 | 2 = 1): number {
  return Math.round(
    CONFIG.heroBaseHp * (1 + up.hp * UPGRADES.hp.per) * levelHpMult(level) * tierHpMult(tier),
  );
}

/** Cost of the next level of an upgrade line (Phase B economy; pure helper). */
export function upgradeCost(stat: keyof Upgrades, level: number): number {
  return Math.round(UPGRADES[stat].base * Math.pow(UPGRADES[stat].growth, level));
}
