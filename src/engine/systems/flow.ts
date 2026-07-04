/**
 * Stage progression (POC `nextStage`).
 *
 * Called after a victory to advance to the next stage: reset the battlefield and
 * progress trackers, unlock the next hero slot (in `SLOT_ORDER`, up to
 * `maxHeroes`), and respawn the team. Upgrades and gold carry over.
 */

import { CONFIG } from "@/engine/config";
import { initHeroes } from "@/engine/state";
import type { GameState } from "@/engine/state";

/** Advance to the next stage. Precondition (checked by caller): phase "victory". */
export function nextStage(state: GameState): void {
  state.stage++;
  state.wave = 0;
  state.kills = 0;
  state.bossReady = false;
  state.phase = "battle";
  state.enemies = [];
  state.projectiles = [];
  state.waveGap = CONFIG.nextStageWaveGap;
  state.anchorX = CONFIG.baseAnchor;
  if (state.heroSlots < CONFIG.maxHeroes) state.heroSlots++;
  initHeroes(state);
  state.events.push({ type: "stageAdvanced", stage: state.stage });
}
