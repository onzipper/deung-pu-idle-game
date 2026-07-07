/**
 * Positional queries used by movement and combat (POC `nearest*` helpers +
 * `enemyTargets` / `aliveHeroes` / `frontHeroX`). All 1-D on the x-axis, exactly
 * like the POC. Pure — no mutation.
 */

import { CONFIG, HERO_TYPES } from "@/engine/config";
import type { Hero, CombatTarget } from "@/engine/entities";
import type { GameState } from "@/engine/state";

interface HasX {
  x: number;
}

/** Nearest entity in `list` to x (by |Δx|), or null if empty. */
export function nearestAny<T extends HasX>(list: readonly T[], x: number): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of list) {
    const d = Math.abs(t.x - x);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Nearest entity within radius `r`, or null. */
export function nearestWithin<T extends HasX>(
  list: readonly T[],
  x: number,
  r: number,
): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of list) {
    const d = Math.abs(t.x - x);
    if (d <= r && d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/**
 * Nearest entity whose SIGNED offset (t.x - x) lies in [minD, maxD]. Used for
 * attack range so a melee hero can reach slightly behind (minD < 0) while ranged
 * heroes only hit forward (minD = 0).
 */
export function nearestTarget<T extends HasX>(
  list: readonly T[],
  x: number,
  minD: number,
  maxD: number,
): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of list) {
    const d = t.x - x;
    if (d >= minD && d <= maxD && d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Heroes that are not currently dead. */
export function aliveHeroes(state: GameState): Hero[] {
  return state.heroes.filter((h) => !h.dead);
}

/**
 * Can ANY alive hero hit a foe standing at world-x `ex` this instant? Mirrors the
 * per-class attack-target test: a melee hero reaches symmetrically (|Δx| ≤ range),
 * a ranged hero only forward (0 ≤ Δx ≤ range). Used to gate a ranged enemy's fire
 * so it never plinks the party from beyond every hero's reach ("มอนตีดาบฟรี").
 */
export function anyHeroCanRetaliate(state: GameState, ex: number): boolean {
  for (const h of state.heroes) {
    if (h.dead) continue;
    const t = HERO_TYPES[h.cls];
    const d = ex - h.x;
    if (t.attack === "melee" ? Math.abs(d) <= t.range : d >= 0 && d <= t.range) {
      return true;
    }
  }
  return false;
}

/** Nearest living hero to x, or null if the whole team is down. */
export function nearestAliveHero(state: GameState, x: number): Hero | null {
  return nearestAny(aliveHeroes(state), x);
}

/** Front-most (largest x) living hero, or the base anchor if none are alive. */
export function frontHeroX(state: GameState): number {
  const alive = aliveHeroes(state);
  return alive.length
    ? Math.max(...alive.map((h) => h.x))
    : CONFIG.baseAnchor;
}

/**
 * The current set of things heroes fight: during a boss fight, the boss PLUS any
 * boss-SUMMONED adds (M7.9 map5 — normal Enemy entities the boss spawned into
 * `state.enemies`), else the live enemy list. For classic bosses (s5/s10/s15) the
 * enemy list is empty during the fight, so this returns exactly `[boss]` — the
 * pre-M7.9 behaviour (byte-identical).
 */
export function getTargets(state: GameState): CombatTarget[] {
  if (state.phase === "boss") {
    if (state.enemies.length === 0) return state.boss ? [state.boss] : [];
    const list: CombatTarget[] = state.boss ? [state.boss] : [];
    for (const e of state.enemies) list.push(e);
    return list;
  }
  // WORLD BOSS "เสี่ยจ๋อง": while an hourly world boss is live it joins the battle-phase
  // target set alongside the farm mobs, so heroes acquire + AoE it and homing shots find
  // it (findById). Byte-identical when none is active (returns the plain enemy list).
  const wb = state.worldBoss;
  if (wb && wb.active && wb.entity) return [...state.enemies, wb.entity];
  return state.enemies;
}
