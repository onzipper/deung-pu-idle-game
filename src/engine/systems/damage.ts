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
 * `wakePassive` (default true) controls the passive-mob RETALIATION latch: a
 * direct/targeted hit always wakes its victim, but AoE callers (see
 * `applyAoeDamage`) pass false for collateral splash so one blast can't aggro a
 * whole passive cluster (M6 hunt follow-up). No RNG; the seeded stream is
 * spawn-composition only.
 */
export function applyDamage(
  state: GameState,
  target: Hero | Enemy | Boss,
  amount: number,
  source: HitSource,
  wakePassive = true,
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
  // Passive-mob RETALIATION (M6 "สนามล่ามอน"): a mob that is HIT starts fighting
  // back, even if it never initiated. Aggressive mobs latch the same flag on aggro
  // (combat.updateEnemies). The boss has no `engaged` field (its own AI).
  if (wakePassive && !isHero(target) && "engaged" in target) target.engaged = true;
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
 * The AoE-aggro rule (M6 hunt follow-up): WAKE only the passive mobs NEAREST the
 * blast centre — within `aoeWakeRadiusFrac × radius`, at most `aoeWakeCap` of them —
 * so one AoE never aggroes an entire dense passive cluster (which used to swarm the
 * kiting archer at the frontier). Damage is applied SEPARATELY (see `damageInRadius`
 * / `applyAoeDamage`); this only latches retaliation. Already-engaged mobs and the
 * boss are ignored (nothing to wake). Deterministic: nearest-first with a LOWER-id
 * tie-break; NO RNG draw (the seeded stream is spawn-composition only). Returns the
 * ids it woke so a caller can decide the wake ONCE per cast (arrow rain's 9 drops).
 */
export function wakeNearestPassives(
  targets: readonly (Hero | Enemy | Boss)[],
  centerX: number,
  radius: number,
): void {
  const { aoeWakeRadiusFrac, aoeWakeCap } = CONFIG.hunt;
  const wakeRadius = radius * aoeWakeRadiusFrac;
  const candidates = targets
    .filter(
      (t): t is Enemy =>
        !isHero(t) && "engaged" in t && !(t as Enemy).engaged && Math.abs(t.x - centerX) < wakeRadius,
    )
    .sort((a, b) => {
      const da = Math.abs(a.x - centerX);
      const db = Math.abs(b.x - centerX);
      return da !== db ? da - db : a.id - b.id;
    });
  for (let i = 0; i < candidates.length && i < aoeWakeCap; i++) candidates[i].engaged = true;
}

/** Damage every target within `radius` of `centerX` WITHOUT waking any passive. */
export function damageInRadius(
  state: GameState,
  targets: readonly (Hero | Enemy | Boss)[],
  centerX: number,
  radius: number,
  amount: number,
  source: HitSource,
): void {
  for (const t of targets) {
    if (Math.abs(t.x - centerX) < radius) applyDamage(state, t, amount, source, false);
  }
}

/**
 * A SINGLE-IMPACT AoE (mage basic orb, meteor, whirl, frost): damage all in radius
 * and wake the capped nearest set in one shot. Multi-drop arrow rain does NOT use
 * this — it decides its wake ONCE at cast (skills.ts) so its 9 drops can't each
 * re-wake the field; the drops then deal no-wake damage via `damageInRadius`.
 */
export function applyAoeDamage(
  state: GameState,
  targets: readonly (Hero | Enemy | Boss)[],
  centerX: number,
  radius: number,
  amount: number,
  source: HitSource,
): void {
  wakeNearestPassives(targets, centerX, radius);
  damageInRadius(state, targets, centerX, radius, amount, source);
}
