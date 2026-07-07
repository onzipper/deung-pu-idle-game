/**
 * Stage progression (POC `nextStage`).
 *
 * Called after a victory to advance to the next stage: reset the battlefield and
 * progress trackers and respawn the hero (M5: hero-unlock-by-stage is gone — the
 * player has one chosen character). Character progression and gold carry over.
 */

import { CONFIG } from "@/engine/config";
import { initHeroes } from "@/engine/state";
import type { GameState } from "@/engine/state";

/** Advance to the next stage. Precondition (checked by caller): phase "victory". */
export function nextStage(state: GameState): void {
  state.stage++;
  state.kills = 0;
  state.bossReady = false;
  state.phase = "battle";
  state.enemies = [];
  state.projectiles = [];
  state.anchorX = CONFIG.baseAnchor;
  // Refill the hunt-field pool for the new stage (M6 "สนามล่ามอน").
  state.spawnBurst = true;
  state.spawnCd = CONFIG.hunt.initialGap;
  initHeroes(state);
  state.events.push({ type: "stageAdvanced", stage: state.stage });
}
