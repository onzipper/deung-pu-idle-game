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

import { heroMaxHpOf, heroMaxManaOf } from "@/engine/systems/stats";
import { isQuestComplete } from "@/engine/systems/quests";
import { autoSlotCapacity } from "@/engine/entities";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/**
 * Whether `hero` may evolve RIGHT NOW (below tier 3 AND its ACTIVE evolution quest is
 * complete). Covers both the tier-1 -> tier-2 class change and the M7.9 tier-2 ->
 * tier-3 grand-expansion evolution (each gated by its own quest — systems/quests
 * `evolutionQuestFor`). Pure read — the UI derives its `canEvolve` snapshot flag from
 * this same rule. (`state` is kept in the signature for future team-wide rules.)
 */
export function canEvolveHero(_state: GameState, hero: Hero): boolean {
  return hero.tier < 3 && isQuestComplete(hero);
}

/**
 * Apply the `evolveHero` intent for the hero at slot `index`. No-op (returns false)
 * if the slot is empty or the requirements are unmet / already tier 3. On success:
 * INCREMENTS the hero's tier (1->2 or 2->3), CONSUMES its quest, recomputes max HP +
 * max MANA with the new tier multipliers/bonus and heals by the added headroom, GROWS
 * the auto-cast loadout to the new tier's capacity (tier 3 gains the 4th slot), and
 * emits an `evolve` event for render/UI juice. No gold is spent (task 5).
 */
export function evolveHero(state: GameState, index: number): boolean {
  const hero = state.heroes[index];
  if (!hero || !canEvolveHero(state, hero)) return false;

  hero.tier = (hero.tier + 1) as 1 | 2 | 3;
  hero.quest = null; // the evolution quest is consumed by the advancement

  // Grow the auto-cast loadout to the new tier's capacity (tier 3 unlocks a 4th slot;
  // tier 2 leaves it at 3 — no-op). Pad with empty slots; never shrinks.
  const cap = autoSlotCapacity(hero.tier);
  while (hero.autoSlots.length < cap) hero.autoSlots.push(null);

  const newMax = heroMaxHpOf(hero);
  hero.hp += newMax - hero.maxHp;
  hero.maxHp = newMax;

  // Tier 3 grants a mana-pool bonus (config `mana.tier3PoolBonus`) — grow the pool and
  // heal the added mana headroom so the fresh tier-3 hero can immediately cast skill-4.
  const newMaxMana = heroMaxManaOf(hero);
  hero.mana += Math.max(0, newMaxMana - hero.maxMana);
  hero.maxMana = newMaxMana;

  state.events.push({
    type: "evolve",
    id: hero.id,
    cls: hero.cls,
    tier: hero.tier,
  });
  return true;
}
