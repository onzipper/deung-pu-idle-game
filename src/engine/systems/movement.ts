/**
 * Formation movement.
 *
 * `updateAnchor` advances the shared formation anchor toward the front line, at
 * a capped speed — the POC's "anchor เดินหน้า" block. Per-entity approach/kite
 * movement is interleaved with attacks and lives in `combat.ts` (kept atomic per
 * entity to preserve the POC's exact move-or-attack, move-then-attack ordering).
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp } from "@/engine/core/math";
import { getTargets } from "@/engine/systems/targeting";
import type { GameState } from "@/engine/state";

/** Ease the formation anchor toward (min enemy x - anchorLead), clamped. */
export function updateAnchor(state: GameState): void {
  let target: number = CONFIG.baseAnchor;
  const targets = getTargets(state);
  if (targets.length) {
    const minEnemyX = Math.min(...targets.map((e) => e.x));
    target = clamp(
      minEnemyX - CONFIG.anchorLead,
      CONFIG.baseAnchor,
      CONFIG.maxAnchor,
    );
  }
  state.anchorX += clamp(
    target - state.anchorX,
    -CONFIG.anchorSpeed * FIXED_DT,
    CONFIG.anchorSpeed * FIXED_DT,
  );
}
