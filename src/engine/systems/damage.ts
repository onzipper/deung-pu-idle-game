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
import { equipDefOf } from "@/engine/systems/stats";
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
 *
 * SURVIVOR-RETALIATION (M7.7, replaces the old `wakePassive`/aoeWakeCap mechanic):
 * a passive mob that is DAMAGED and SURVIVES (`hp > 0` after the hit) becomes
 * ENGAGED and fights back — a mob KILLED by the hit does not (it's gone). This
 * fires UNIFORMLY for every mob hit (basic attacks kept their old feel: a
 * surviving target still retaliates, a killed one is just removed), so a hero
 * SKILL that blankets a cluster wakes every TOUGH SURVIVOR — the frontier heat —
 * while a cluster it one-shots stays silent. No RNG; deterministic; the seeded
 * stream is spawn-composition only. The boss has no `engaged` field (its own AI).
 */
export function applyDamage(
  state: GameState,
  target: Hero | Enemy | Boss,
  amount: number,
  source: HitSource,
): void {
  // M7 gear DEF: FLAT per-hit mitigation on heroes only, floored so armor can't
  // make a hero unkillable. Guarded on `def > 0` so an UNARMORED hero's incoming
  // damage (and the emitted `hit` amount) is byte-identical to pre-M7 — the
  // balance-m6 curves are untouched when no gear is equipped.
  if (isHero(target)) {
    const def = equipDefOf(target);
    if (def > 0) amount = Math.max(CONFIG.gear.minDamage, amount - def);
  }
  target.hp -= amount;
  // Survivor-retaliation: a mob that took damage and LIVED starts fighting back.
  // A killed mob (hp <= 0) is NOT engaged (it's removed this step) — so a skill
  // that one-shots a passive cluster wakes nobody, and only survivors retaliate.
  if (!isHero(target) && "engaged" in target && target.hp > 0) target.engaged = true;
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

/**
 * Damage every target within `radius` of `centerX`. Each mob that SURVIVES the hit
 * retaliates (via `applyDamage`'s survivor-retaliation, M7.7) — so an AoE wakes its
 * tough survivors and stays silent on a cluster it one-shots. No RNG; deterministic.
 */
export function damageInRadius(
  state: GameState,
  targets: readonly (Hero | Enemy | Boss)[],
  centerX: number,
  radius: number,
  amount: number,
  source: HitSource,
): void {
  for (const t of targets) {
    if (Math.abs(t.x - centerX) < radius) applyDamage(state, t, amount, source);
  }
}

/**
 * A single-impact AoE (mage basic orb, meteor, whirl, frost, quake, cataclysm) — an
 * alias of `damageInRadius`. M7.7 unified the waking model: there is no longer a
 * separate "wake the capped nearest set" pass; survivor-retaliation (any damaged mob
 * that lives → engaged) is applied per-target inside `applyDamage`, so single-impact
 * blasts and multi-drop rain share ONE code path.
 */
export function applyAoeDamage(
  state: GameState,
  targets: readonly (Hero | Enemy | Boss)[],
  centerX: number,
  radius: number,
  amount: number,
  source: HitSource,
): void {
  damageInRadius(state, targets, centerX, radius, amount, source);
}
