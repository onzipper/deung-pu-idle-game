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
 * smaller lead + high cap + faster ease speed, so the whole team — ranged heroes
 * included — surges forward and rides right up near the enemy line so their range
 * covers the pushed-up fight (86d3k2nhm).
 *
 * Between waves (phase "battle", no enemies alive) the anchor HOLDS its forward
 * line rather than retreating to base: the team is journeying forward, so it must
 * never visibly walk backwards during a waveGap. Only outside a live battle
 * (e.g. after a victory, before the next stage resets it) does it ease calmly home.
 */
export function updateAnchor(state: GameState): void {
  const targets = getTargets(state);
  if (targets.length) {
    const minEnemyX = Math.min(...targets.map((e) => e.x));
    // During the boss phase the lone boss engages near the spawn edge (~836), well
    // beyond the shared battleMaxAnchor(510). Use a deeper boss-only cap so the anchor
    // tracks the boss and the ranged heroes stay in range of it (playtest fix
    // "ตัวตีไกลไม่ตีบอส"). Normal waves keep the shallower cap so pacing is unchanged.
    const maxAnchor =
      state.phase === "boss" ? CONFIG.boss.maxAnchor : CONFIG.battleMaxAnchor;
    const target = clamp(
      minEnemyX - CONFIG.battleAnchorLead,
      CONFIG.baseAnchor,
      maxAnchor,
    );
    state.anchorX += clamp(
      target - state.anchorX,
      -CONFIG.battleAnchorSpeed * FIXED_DT,
      CONFIG.battleAnchorSpeed * FIXED_DT,
    );
    return;
  }

  // No enemies. During an active stage this is a between-waves gap: hold the
  // forward line (no retreat). Otherwise ease home at the calm base speed.
  if (state.phase === "battle") return;
  state.anchorX += clamp(
    CONFIG.baseAnchor - state.anchorX,
    -CONFIG.anchorSpeed * FIXED_DT,
    CONFIG.anchorSpeed * FIXED_DT,
  );
}
