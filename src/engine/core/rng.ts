/**
 * Seeded, deterministic RNG (mulberry32).
 *
 * The engine must never call `Math.random()` — a seeded stream is what makes
 * headless simulations reproducible and lets a saved seed replay identically.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Current internal state — persist this in the save to resume the stream. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state() {
      return s >>> 0;
    },
  };
}
