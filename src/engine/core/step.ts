/**
 * The single fixed-timestep transition: `step(state, input) -> state`.
 *
 * Advances exactly one `FIXED_DT`. Callers use `drainAccumulator` to decide how
 * many steps to run per frame (speed multiplier = more steps, never a bigger
 * dt). Deterministic given `(state, input)` and the RNG cursor in state.
 *
 * The systems run in the POC's update order. `step` MUTATES and returns the same
 * `state` object — the transformation is the mutation; there is no hidden I/O,
 * no wall-clock read, and randomness comes only from the seeded RNG rebuilt from
 * `state.rngState` each step.
 */

import { FIXED_DT } from "@/engine/core/loop";
import { createRng } from "@/engine/core/rng";
import type { GameState } from "@/engine/state";
import { updateAnchor } from "@/engine/systems/movement";
import { updateWaveSpawns } from "@/engine/systems/waves";
import { processSkills } from "@/engine/systems/skills";
import { buyUpgrade, processAutoUpgrade } from "@/engine/systems/upgrades";
import { startBossFight, updateBoss } from "@/engine/systems/boss";
import { nextStage } from "@/engine/systems/flow";
import {
  decayHeroTimers,
  updateEnemies,
  updateHeroes,
  updateProjectiles,
  resolveDeaths,
} from "@/engine/systems/combat";

/** Per-step player input. Every field is optional; omit for a pure idle step. */
export interface FrameInput {
  /** Hero-slot indices to cast a skill this step (subject to the range guard). */
  castSkills?: number[];
  /** Upgrade line to purchase this step, if affordable / uncapped. */
  buyUpgrade?: "atk" | "speed" | "hp";
  /** Begin the boss fight (only honoured when bossReady && phase "battle"). */
  challengeBoss?: boolean;
  /** Advance to the next stage (only honoured when phase "victory"). */
  advanceStage?: boolean;
}

export function step(state: GameState, input: FrameInput = {}): GameState {
  const rng = createRng(state.rngState);

  // Drop last step's events before this step fills them (one-way render/audio
  // buffer). Clear-in-place keeps the array identity stable and allocation-light.
  state.events.length = 0;

  // --- discrete player actions (valid across phases) ---
  if (input.buyUpgrade) buyUpgrade(state, input.buyUpgrade);
  if (input.advanceStage && state.phase === "victory") nextStage(state);
  if (input.challengeBoss && state.bossReady && state.phase === "battle") {
    startBossFight(state);
  }

  // Victory pauses the sim (the POC loop skipped update() while victorious).
  // An advanceStage above may already have flipped us back to "battle".
  if (state.phase === "victory") {
    state.rngState = rng.state();
    return state;
  }

  decayHeroTimers(state);
  processSkills(state, input); // manual casts + guarded auto-cast
  updateAnchor(state);
  updateWaveSpawns(state, rng);
  updateEnemies(state); // no-op during the boss phase (field is cleared)
  if (state.phase === "boss") updateBoss(state);
  updateHeroes(state);
  updateProjectiles(state);
  processAutoUpgrade(state);
  resolveDeaths(state); // enemy kills / boss kill / boss retreat / bossReady

  state.time += FIXED_DT;
  state.rngState = rng.state();
  return state;
}
