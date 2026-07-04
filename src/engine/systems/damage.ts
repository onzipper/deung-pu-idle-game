/**
 * Damage application — the one place HP is reduced, so hero death/revive stays
 * consistent everywhere (basic attacks, projectiles, skills, boss slam).
 * Extracted into its own module so `combat` and `boss` can share it without a
 * circular import.
 */

import { CONFIG } from "@/engine/config";
import type { Hero, Enemy, Boss } from "@/engine/entities";

/** A hero is the only target that dies-and-revives; enemies/boss just drop HP. */
export function isHero(t: Hero | Enemy | Boss): t is Hero {
  return "reviveTimer" in t;
}

/** Apply `amount` damage; start a hero's revive timer when it drops. */
export function applyDamage(target: Hero | Enemy | Boss, amount: number): void {
  target.hp -= amount;
  if (isHero(target) && target.hp <= 0 && !target.dead) {
    target.dead = true;
    target.reviveTimer = CONFIG.heroReviveTime;
  }
}
