/**
 * Class advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3).
 *
 * A PLAYER-TRIGGERED third power axis: the player advances a hero from tier 1 to
 * tier 2, granting a permanent atk/hp multiplier (systems/stats `tierAtkMult` /
 * `tierHpMult`) that compounds MULTIPLICATIVELY with the per-hero level bonus AND
 * base-stat allocation.
 *
 * TRIGGER (M5 task 5): the class-change QUEST replaced the old gold cost — the
 * player earns the class change through quest EFFORT (kills + a boss), not gold.
 * Requirements (both, else the intent is a no-op):
 *   - the hero is still tier 1 (single evolution path in M5),
 *   - the hero's class-change quest is COMPLETE (`systems/quests.isQuestComplete`).
 * The quest is only offerable at `CONFIG.evolution.levelRequired`, so the level
 * gate still times the beat; see the economy note in `config` (no gold sink now).
 *
 * NO RNG is drawn here (evolution is deterministic), so the seeded stream stays
 * reserved for wave composition. Flows through the `evolveHero` FrameInput intent
 * exactly like a skill click — applied once per drained input, at any speed.
 */

import { heroMaxHpOf } from "@/engine/systems/stats";
import { isQuestComplete } from "@/engine/systems/quests";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/**
 * Whether `hero` may evolve RIGHT NOW (tier 1 AND its class-change quest complete).
 * Pure read — the UI derives its `canEvolve` snapshot flag from this same rule.
 * (`state` is kept in the signature for API stability / future team-wide rules.)
 */
export function canEvolveHero(_state: GameState, hero: Hero): boolean {
  return hero.tier < 2 && isQuestComplete(hero);
}

/**
 * Apply the `evolveHero` intent for the hero at slot `index`. No-op (returns
 * false) if the slot is empty or the requirements are unmet / already tier 2.
 * On success: flips the hero to tier 2, CONSUMES its quest (clears `quest`),
 * recomputes max HP with the tier multiplier and heals by the added headroom, and
 * emits an `evolve` event for render/UI juice. No gold is spent (task 5).
 */
export function evolveHero(state: GameState, index: number): boolean {
  const hero = state.heroes[index];
  if (!hero || !canEvolveHero(state, hero)) return false;

  hero.tier = 2;
  hero.quest = null; // the class-change quest is consumed by the advancement

  const newMax = heroMaxHpOf(hero);
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
