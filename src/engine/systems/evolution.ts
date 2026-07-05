/**
 * Class advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3).
 *
 * A PLAYER-TRIGGERED third power axis: the player spends gold to advance a hero
 * from tier 1 to tier 2, granting a permanent atk/hp multiplier (systems/stats
 * `tierAtkMult` / `tierHpMult`) that compounds MULTIPLICATIVELY with the upgrade
 * lines AND the per-hero level bonus.
 *
 * Requirements (both must hold, else the intent is a no-op):
 *   - the hero is still tier 1 (single evolution path in M5),
 *   - `hero.level >= CONFIG.evolution.levelRequired`,
 *   - `state.gold >= evolutionCost(hero.cls)`.
 *
 * NO RNG is drawn here (evolution is deterministic), so the seeded stream stays
 * reserved for wave composition. Flows through the `evolveHero` FrameInput intent
 * exactly like a buy/skill click — applied once per drained input, at any speed.
 */

import { CONFIG, SLOT_ORDER } from "@/engine/config";
import { heroMaxHp } from "@/engine/systems/stats";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** Gold cost to evolve a hero of class `cls` (scales by unlock-slot index). */
export function evolutionCost(cls: Hero["cls"]): number {
  return CONFIG.evolution.cost(SLOT_ORDER.indexOf(cls));
}

/**
 * Whether `hero` may evolve RIGHT NOW (tier 1, level gate met, gold affordable).
 * Pure read — the UI derives its `canEvolve` snapshot flag from this same rule.
 */
export function canEvolveHero(state: GameState, hero: Hero): boolean {
  return (
    hero.tier < 2 &&
    hero.level >= CONFIG.evolution.levelRequired &&
    state.gold >= evolutionCost(hero.cls)
  );
}

/**
 * Apply the `evolveHero` intent for the hero at slot `index`. No-op (returns
 * false) if the slot is empty or the requirements are unmet / already tier 2.
 * On success: spends the gold, flips the hero to tier 2, recomputes max HP with
 * the tier multiplier and heals by the added headroom, and emits an `evolve`
 * event for render/UI juice.
 */
export function evolveHero(state: GameState, index: number): boolean {
  const hero = state.heroes[index];
  if (!hero || !canEvolveHero(state, hero)) return false;

  state.gold -= evolutionCost(hero.cls);
  hero.tier = 2;

  const newMax = heroMaxHp(hero.cls, hero.level, hero.tier);
  hero.hp += newMax - hero.maxHp;
  hero.maxHp = newMax;

  state.events.push({
    type: "evolve",
    id: hero.id,
    cls: hero.cls,
    tier: hero.tier,
  });
  return true;
}
