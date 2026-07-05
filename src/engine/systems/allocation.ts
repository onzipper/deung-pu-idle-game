/**
 * Base-stat allocation (M5 "Base stats", 86d3jv7m3).
 *
 * Two paths, both deterministic (NO RNG — the seeded stream stays reserved for
 * wave composition):
 *
 *  - MANUAL: the `allocateStat` FrameInput intent spends unspent `statPoints` into
 *    one stat, applied once per drained input (a click allocates exactly once, at
 *    any speed — same semantics as `evolveHero`). Guarded against negative /
 *    non-integer amounts, over-spend, and the per-stat cap. Emits a `statAllocated`
 *    event ONLY on manual allocation (UI feedback; render draws nothing from it).
 *
 *  - AUTO: when the UI-owned `autoAllocate` toggle is on, every hero's unspent
 *    points are dumped into its class PRIMARY stat, so an idle player never drowns
 *    in unspent points. Emits NO event (silent, mirrors auto-cast).
 *
 * Allocating VIT recomputes max HP and heals by the added headroom (a level-up /
 * evolution style feel-good bump); the other stats change derived atk/atk-speed on
 * read, so they need no state fix-up.
 */

import { CONFIG, PRIMARY_STAT } from "@/engine/config";
import { heroMaxHpOf } from "@/engine/systems/stats";
import type { Hero, StatKey } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** Re-derive max HP after a vit change and heal by the added headroom. */
function refreshMaxHp(hero: Hero): void {
  const newMax = heroMaxHpOf(hero);
  hero.hp += newMax - hero.maxHp;
  hero.maxHp = newMax;
}

/**
 * Spend `amount` unspent points into `hero.stats[stat]`. Returns false (no-op) if
 * the hero is missing, the amount is not a positive integer, it exceeds the
 * unspent pool, or it would breach `CONFIG.stats.cap`. On success emits a
 * `statAllocated` event (manual-only feedback).
 */
export function allocateStat(
  state: GameState,
  hero: Hero | undefined,
  stat: StatKey,
  amount: number,
): boolean {
  if (!hero) return false;
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (amount > hero.statPoints) return false;
  if (hero.stats[stat] + amount > CONFIG.stats.cap) return false;

  hero.statPoints -= amount;
  hero.stats[stat] += amount;
  if (stat === "vit") refreshMaxHp(hero);

  state.events.push({ type: "statAllocated", id: hero.id, stat, amount });
  return true;
}

/**
 * Auto-allocate: dump every hero's unspent points into its class PRIMARY stat
 * (clamped to the cap). Silent (no event). Idempotent once points are drained.
 */
export function autoAllocateStats(state: GameState): void {
  for (const hero of state.heroes) {
    if (hero.statPoints <= 0) continue;
    const stat = PRIMARY_STAT[hero.cls];
    const room = CONFIG.stats.cap - hero.stats[stat];
    const amount = Math.min(hero.statPoints, room);
    if (amount <= 0) continue;
    hero.statPoints -= amount;
    hero.stats[stat] += amount;
    // Primary is never vit for the current classes, but keep HP consistent if a
    // future class's primary were vit.
    if (stat === "vit") refreshMaxHp(hero);
  }
}

/**
 * Per-step allocation pass: apply the manual intent (to the solo hero) first, then
 * auto-allocate when the toggle is on. Called from `step()`.
 */
export function processStatAllocation(
  state: GameState,
  alloc: { stat: StatKey; amount: number } | undefined,
): void {
  if (alloc) allocateStat(state, state.heroes[0], alloc.stat, alloc.amount);
  if (state.autoAllocate) autoAllocateStats(state);
}
