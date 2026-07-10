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
/**
 * Root scale at d=0 (far / upstage).
 *
 * R4.5 Wave 1 (issue #69, projection C — "MMO field board with subtle depth"):
 * capped from the original `0.8` → `0.95`. The old 0.8↔1.12 band was a 40% size
 * swing that shrank far-row actors so hard they read as "randomly tiny" instead
 * of "further away". The rule now is **scale is a whisper, composition sells
 * depth** — foot-sort zIndex + contact shadows carry the depth read, the size
 * change only nudges it. Offsets (`DEPTH_OFFSET_*`) are UNCHANGED: vertical
 * position separation was never the problem, only the over-tuned scale.
 */
export const DEPTH_SCALE_FAR = 0.95;
/**
 * Root scale at d=1 (near / downstage). Capped from the original `1.12` → `1.06`
 * — see `DEPTH_SCALE_FAR` above for the R4.5 Wave 1 rationale.
 */
export const DEPTH_SCALE_NEAR = 1.06;

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
