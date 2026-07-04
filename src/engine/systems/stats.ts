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

/** Attack damage for a hero of class `cls` at the given upgrade levels. */
export function heroAtk(cls: HeroClass, up: Upgrades): number {
  return Math.round(
    CONFIG.heroBaseAtk * (1 + up.atk * UPGRADES.atk.per) * HERO_TYPES[cls].dmgMult,
  );
}

/** Seconds between attacks (lower = faster). Only the speed line is capped. */
export function heroAtkSpeed(cls: HeroClass, up: Upgrades): number {
  const spd = Math.min(up.speed, SPEED_UPGRADE_CAP);
  return HERO_TYPES[cls].atkSpeed / (1 + spd * UPGRADES.speed.per);
}

/** Max HP shared by all heroes at the given upgrade levels. */
export function heroMaxHp(up: Upgrades): number {
  return Math.round(CONFIG.heroBaseHp * (1 + up.hp * UPGRADES.hp.per));
}

/** Cost of the next level of an upgrade line (Phase B economy; pure helper). */
export function upgradeCost(stat: keyof Upgrades, level: number): number {
  return Math.round(UPGRADES[stat].base * Math.pow(UPGRADES[stat].growth, level));
}
