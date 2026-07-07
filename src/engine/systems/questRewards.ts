/**
 * Quest REWARD granting (M8 Wave A) — the single choke point every main/daily quest
 * reward flows through, so a reward can only ever move numbers the game already knows
 * how to move (owner taste: NO power items — gold / refine stones / potions only).
 *
 * PURITY / DETERMINISM: no RNG (the seeded stream stays wave-composition only), no
 * wall-clock. Gold funnels through `creditGold` so a reward also banks the M7.95
 * lifetime `goldEarned` total; materials + potions are clamped exactly like their
 * normal grant sites. INERT BY DESIGN: nothing here runs unless a claim intent fires,
 * so the balance sim (which never claims) is byte-identical.
 */

import { CONFIG } from "@/engine/config";
import { creditGold } from "@/engine/systems/economy";
import type { GameState } from "@/engine/state";

/**
 * A quest reward (main-chapter or daily). Every field OPTIONAL; a missing field grants
 * nothing. Deliberately narrow — gold / refine materials / hp+mana potion stacks only.
 */
export interface QuestReward {
  gold?: number;
  /** Refine "หินเสริมพลัง" stones (the `state.materials` counter). */
  materials?: number;
  hpPotion?: number;
  manaPotion?: number;
}

/**
 * Grant `reward` into the live economy: gold via `creditGold` (banks `goldEarned`),
 * materials added (floored non-negative), potion stacks added (clamped to the shop
 * stack cap so a reward can never over-stack). Returns the ACTUAL granted amounts (for
 * the emitting event's payload) so a stack-capped potion reward reports what really
 * landed. Non-finite / non-positive fields are ignored.
 */
export function grantQuestReward(
  state: GameState,
  reward: QuestReward,
): { gold: number; materials: number; hpPotion: number; manaPotion: number } {
  const cap = CONFIG.shop.stackCap;
  const pos = (v: number | undefined): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

  const gold = pos(reward.gold);
  const materials = pos(reward.materials);
  const hpWant = pos(reward.hpPotion);
  const mpWant = pos(reward.manaPotion);

  if (gold > 0) creditGold(state, gold);
  if (materials > 0) state.materials = Math.max(0, state.materials + materials);

  const hpBefore = state.consumables.hpPotion ?? 0;
  const mpBefore = state.consumables.manaPotion ?? 0;
  const hpAfter = Math.min(cap, hpBefore + hpWant);
  const mpAfter = Math.min(cap, mpBefore + mpWant);
  state.consumables.hpPotion = hpAfter;
  state.consumables.manaPotion = mpAfter;

  return { gold, materials, hpPotion: hpAfter - hpBefore, manaPotion: mpAfter - mpBefore };
}
