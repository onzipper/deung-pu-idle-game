/**
 * Damage application — the one place HP is reduced, so hero death/revive stays
 * consistent everywhere (basic attacks, projectiles, skills, boss slam).
 * Extracted into its own module so `combat` and `boss` can share it without a
 * circular import.
 *
 * This is also the single choke point that emits the transient `hit` event (and
 * `heroDown` when a hero drops) into `state.events` for the render/audio layer.
 */

import { CONFIG } from "@/engine/config";
import type { Hero, Enemy, Boss } from "@/engine/entities";
import type { GameState, HitSource, HitTargetKind } from "@/engine/state";

/** A hero is the only target that dies-and-revives; enemies/boss just drop HP. */
export function isHero(t: Hero | Enemy | Boss): t is Hero {
  return "reviveTimer" in t;
}

/** Classify a damage target for the `hit` event discriminant. */
function targetKind(t: Hero | Enemy | Boss): HitTargetKind {
  if (isHero(t)) return "hero";
  return "kind" in t ? "enemy" : "boss";
}

/**
 * Apply `amount` damage; start a hero's revive timer when it drops. Emits a
 * `hit` event (and `heroDown` on a fresh hero death) tagged with `source` so the
 * render layer can flavour the reaction.
 */
export function applyDamage(
  state: GameState,
  target: Hero | Enemy | Boss,
  amount: number,
  source: HitSource,
): void {
  target.hp -= amount;
  // Passive-mob RETALIATION (M6 "สนามล่ามอน"): a mob that is HIT starts fighting
  // back, even if it never initiated. Aggressive mobs latch the same flag on aggro
  // (combat.updateEnemies). The boss has no `engaged` field (its own AI).
  if (!isHero(target) && "engaged" in target) target.engaged = true;
  state.events.push({
    type: "hit",
    target: targetKind(target),
    id: target.id,
    x: target.x,
    y: target.y,
    amount,
    source,
  });
  if (isHero(target) && target.hp <= 0 && !target.dead) {
    target.dead = true;
    target.reviveTimer = CONFIG.heroReviveTime;
    state.events.push({
      type: "heroDown",
      id: target.id,
      cls: target.cls,
      x: target.x,
      y: target.y,
    });
  }
}
