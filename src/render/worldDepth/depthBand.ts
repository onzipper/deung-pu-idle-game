/**
 * Depth band math for `/lab` experiment ⑨ "โลกมีมิติ" — pure, NO Pixi/DOM.
 *
 * Entities get a depth coordinate d ∈ [0,1] (0 = far / upstage, 1 = near /
 * downstage) and this module maps it to the three render-side effects that
 * sell 2.5D on a single ground line:
 *   - `depthOffsetY(d)` — px added to the entity root's y (far rows stand
 *     higher on screen, near rows lower);
 *   - `depthScale(d)`   — uniform root scale (far smaller, near bigger);
 *   - `depthZIndex(d)`  — sort key for a `sortableChildren` entity layer so
 *     near entities draw OVER far ones.
 *
 * All three are strictly monotonic in d (test-enforced) so the band never
 * "folds": if A is nearer than B it is ALWAYS lower, bigger, and in front.
 * Offsets share the plan's headroom budget with terrain: worst-case feet
 * ≈ GROUND_Y + 10 (terrain) + 40 (near offset) = 282 < WORLD_HEIGHT 300.
 */

// ---------------------------------------------------------------------------
// Knobs — the band's screen-space envelope.
// ---------------------------------------------------------------------------

/** y offset at d=0 (far row: raised toward the horizon). */
export const DEPTH_OFFSET_FAR = -24;
/** y offset at d=1 (near row: dropped toward the camera). */
export const DEPTH_OFFSET_NEAR = 40;
/** Root scale at d=0. */
export const DEPTH_SCALE_FAR = 0.8;
/** Root scale at d=1. */
export const DEPTH_SCALE_NEAR = 1.12;

/** zIndex quantization: d*1000 rounded — plenty of rungs for ~15 actors. */
const Z_INDEX_STEPS = 1000;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Clamp a depth coordinate into the band's [0,1] domain. */
export function clampDepth(d: number): number {
  return Math.max(0, Math.min(1, d));
}

/** y offset (px) for depth d — lerp FAR→NEAR, strictly increasing in d. */
export function depthOffsetY(d: number): number {
  const c = clampDepth(d);
  return DEPTH_OFFSET_FAR + (DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR) * c;
}

/** Uniform root scale for depth d — lerp FAR→NEAR, strictly increasing in d. */
export function depthScale(d: number): number {
  const c = clampDepth(d);
  return DEPTH_SCALE_FAR + (DEPTH_SCALE_NEAR - DEPTH_SCALE_FAR) * c;
}

/** Integer sort key preserving depth order (nearer ⇒ strictly ≥, drawn later). */
export function depthZIndex(d: number): number {
  return Math.round(clampDepth(d) * Z_INDEX_STEPS);
}
