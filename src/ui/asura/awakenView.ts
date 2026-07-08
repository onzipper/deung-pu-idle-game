/**
 * Pure "ปลุกพลัง" awaken UI logic (endgame v1.3) — the cost/gate derivation
 * both `AsuraTomePanel.tsx` and the inventory `DetailCard` render, and the
 * headless UI test exercises. NO React / network here: given a legendary's
 * current +level and the player's gold + stone (materials) balances, it returns
 * the next target, its `awakenCost`, and whether the button is ready or blocked
 * (and by which resource). Mirrors the SERVER's `awakenLegendary` gate order
 * (gold checked before stones) so the disabled-reason copy matches the 409.
 */

import { LEGENDARY_MAX_AWAKEN, awakenCost, clampRefineForTemplate } from "@/engine";

export type AwakenGate =
  | { status: "maxed"; current: number; max: number }
  | {
      status: "ready" | "gold" | "stones";
      current: number;
      max: number;
      /** The +level this next awaken would reach (current + 1). */
      target: number;
      cost: { gold: number; stones: number };
    };

/**
 * The awaken affordance for a legendary at `refineLevel` (its awaken +level),
 * given the player's `gold` + `stones` (materials). "maxed" once at
 * `LEGENDARY_MAX_AWAKEN` (+5); otherwise "ready", or blocked on "gold"/"stones"
 * (gold first — the server's check order). `current`/`max` drive the "+N/5"
 * readout; `cost`/`target` drive the next-step cost line + the POST.
 */
export function awakenGate(
  templateId: string,
  refineLevel: number,
  gold: number,
  stones: number,
): AwakenGate {
  const current = clampRefineForTemplate(templateId, refineLevel);
  const max = LEGENDARY_MAX_AWAKEN;
  if (current >= max) return { status: "maxed", current, max };
  const target = current + 1;
  const cost = awakenCost(target) ?? { gold: 0, stones: 0 };
  if (gold < cost.gold) return { status: "gold", current, max, target, cost };
  if (stones < cost.stones) return { status: "stones", current, max, target, cost };
  return { status: "ready", current, max, target, cost };
}
