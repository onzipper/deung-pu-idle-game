/**
 * Fixed-timestep loop with accumulator.
 *
 * Deterministic simulation regardless of frame rate. A speed multiplier runs
 * MORE sub-steps of the same fixed `dt` — it never scales `dt` itself, which is
 * what keeps collisions from tunnelling at 2x/3x.
 *
 * Offline idle catch-up uses the same primitive: feed the elapsed offline time
 * as `frameTime` (capped) and it advances the sim in identical fixed steps.
 *
 * NOTE: skeleton only — `step()` wiring lands with the engine port (M1).
 */

/** Fixed simulation step in seconds (60 Hz). */
export const FIXED_DT = 1 / 60;

/** Safety cap on sub-steps per frame to avoid a spiral-of-death on long stalls. */
export const MAX_SUBSTEPS = 300;

export interface Accumulator {
  /** Leftover time (seconds) not yet consumed by a fixed step. */
  remainder: number;
}

export function createAccumulator(): Accumulator {
  return { remainder: 0 };
}

/**
 * Given elapsed wall-time for a frame and a speed multiplier, returns how many
 * fixed steps to run this frame and updates the accumulator remainder.
 */
export function drainAccumulator(
  acc: Accumulator,
  frameTime: number,
  speed: number,
): number {
  acc.remainder += frameTime * speed;
  let steps = 0;
  while (acc.remainder >= FIXED_DT && steps < MAX_SUBSTEPS) {
    acc.remainder -= FIXED_DT;
    steps++;
  }
  return steps;
}
