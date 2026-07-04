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

/**
 * Ease the formation anchor toward (min enemy x - lead), clamped.
 *
 * In BATTLE (enemies present) the anchor uses the aggressive `battle*` knobs: a
 * smaller lead + higher cap + faster ease speed, so the whole team — ranged
 * heroes included — surges forward to meet the enemy line instead of hanging back
 * at base. With no enemies it eases home at the calmer base speed/cap.
 */
export function updateAnchor(state: GameState): void {
  const targets = getTargets(state);
  let target: number = CONFIG.baseAnchor;
  let speed: number = CONFIG.anchorSpeed;
  if (targets.length) {
    const minEnemyX = Math.min(...targets.map((e) => e.x));
    target = clamp(
      minEnemyX - CONFIG.battleAnchorLead,
      CONFIG.baseAnchor,
      CONFIG.battleMaxAnchor,
    );
    speed = CONFIG.battleAnchorSpeed;
  }
  state.anchorX += clamp(
    target - state.anchorX,
    -speed * FIXED_DT,
    speed * FIXED_DT,
  );
}
