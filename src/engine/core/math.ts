/**
 * Small deterministic math helpers shared by the systems.
 * Pure functions only — no RNG, no wall-clock.
 */

/** Clamp `v` into the inclusive range [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
