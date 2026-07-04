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
import {
  decayHeroTimers,
  updateEnemies,
  updateHeroes,
  updateProjectiles,
  resolveDeaths,
} from "@/engine/systems/combat";

/**
 * Per-step player input. Phase A wires no player actions yet; Phase B populates
 * this (skill casts, upgrade purchases, boss challenge, auto toggles).
 */
export interface FrameInput {
  /** Hero-slot indices to cast a skill this step (Phase B). */
  castSkills?: number[];
  /** Upgrade line to purchase this step, if affordable (Phase B). */
  buyUpgrade?: "atk" | "speed" | "hp";
  /** Begin the boss fight this step (Phase B). */
  challengeBoss?: boolean;
}

export function step(
  state: GameState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Phase B reads player input here.
  input: FrameInput = {},
): GameState {
  // Victory pauses the sim (the POC loop skipped update() while victorious).
  if (state.phase === "victory") return state;

  const rng = createRng(state.rngState);

  decayHeroTimers(state);
  // --- skills hook (Phase B): auto-cast + queued casts run here, before movement.
  updateAnchor(state);
  updateWaveSpawns(state, rng);
  updateEnemies(state);
  updateHeroes(state);
  updateProjectiles(state);
  resolveDeaths(state);
  // --- boss hook (Phase B): boss spawn/slam/enrage/retreat + victory transition.

  state.time += FIXED_DT;
  state.rngState = rng.state();
  return state;
}
