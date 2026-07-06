/**
 * Small deterministic math helpers shared by the systems.
 * Pure functions only — no RNG, no wall-clock.
 */

/** Clamp `v` into the inclusive range [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation from `a` to `b` by `t` (t in [0,1] for the closed range). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sign of `v`: -1, 0, or +1 (0 for exactly 0, so a zero delta never moves). */
export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
