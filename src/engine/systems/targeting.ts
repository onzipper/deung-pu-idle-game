/**
 * Positional queries used by movement and combat (POC `nearest*` helpers +
 * `enemyTargets` / `aliveHeroes` / `frontHeroX`). All 1-D on the x-axis, exactly
 * like the POC. Pure — no mutation.
 */

import { CONFIG } from "@/engine/config";
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
 * The current set of things heroes fight: the boss during a boss fight, else the
 * live enemy list. (Phase A never enters the boss phase, so this is the enemies.)
 */
export function getTargets(state: GameState): CombatTarget[] {
  if (state.phase === "boss") return state.boss ? [state.boss] : [];
  return state.enemies;
}
