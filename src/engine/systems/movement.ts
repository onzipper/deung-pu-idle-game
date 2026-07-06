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
import { aliveHeroes } from "@/engine/systems/targeting";
import type { GameState } from "@/engine/state";

/**
 * Ease the formation anchor.
 *
 * BOSS PHASE (unchanged): the lone boss engages near the spawn edge, so the anchor
 * tracks (boss.x − lead) up to the deeper boss-only cap, keeping the ranged heroes
 * in range of it ("ตัวตีไกลไม่ตีบอส"). The boss fight is untouched by the M6 rework.
 *
 * FARM / HUNT PHASE (M6 "สนามล่ามอน"): there is no forward march — each hero hunts
 * to its own target (combat.updateHeroes). The anchor is no longer a movement gate
 * here; it merely EASES toward the front hero so the render "marching" cue (derived
 * from a rising anchor) still reads while the hero advances across the field.
 */
export function updateAnchor(state: GameState): void {
  if (state.phase === "boss") {
    const boss = state.boss;
    if (!boss) return;
    const target = clamp(
      boss.x - CONFIG.battleAnchorLead,
      CONFIG.baseAnchor,
      CONFIG.boss.maxAnchor,
    );
    state.anchorX += clamp(
      target - state.anchorX,
      -CONFIG.battleAnchorSpeed * FIXED_DT,
      CONFIG.battleAnchorSpeed * FIXED_DT,
    );
    return;
  }

  const alive = aliveHeroes(state);
  if (!alive.length) return;
  const frontX = Math.max(...alive.map((h) => h.x));
  const target = clamp(frontX, CONFIG.baseAnchor, CONFIG.battleMaxAnchor);
  state.anchorX += clamp(
    target - state.anchorX,
    -CONFIG.battleAnchorSpeed * FIXED_DT,
    CONFIG.battleAnchorSpeed * FIXED_DT,
  );
}
