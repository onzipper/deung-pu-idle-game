/**
 * Pointer hit-test math for the promoted "โลกมีมิติ" living camera — pure, NO
 * Pixi/DOM. When the camera is wired, taps land on a `cameraRoot` that is a
 * child of the letterboxed `world`, so a screen point must be un-projected
 * through BOTH transforms to reach world coords.
 *
 * Composition (matches GameRenderer's containers):
 *   screen = base.xy + (cam.xy + world·cam.scale)·base.scale
 * so the inverse is
 *   world  = ((screen − base.xy)/base.scale − cam.xy)/cam.scale.
 * With the camera OFF (cam = {x:0,y:0,scale:1}) this collapses to the current
 * `(screen − base.xy)/base.scale`, i.e. today's tap math exactly.
 *
 * `enemyTapCenterY` generalizes GameRenderer's hard-coded ellipse center
 * `GROUND_Y − 14·size`: with the world layers OFF (footY = GROUND_Y, depthScl
 * = 1) it reproduces that value bit-for-bit; ON it rides the entity's lifted
 * foot line and depth scale.
 */

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Enemy tap ellipse center rises this many px above the foot per unit `size`
 * (mirrors GameRenderer's `GROUND_Y - 14 * e.size`). */
export const TAP_CENTER_RISE_PER_SIZE = 14;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The `cameraRoot`'s live transform (its Pixi position + uniform scale). */
export interface CamView {
  x: number;
  y: number;
  scale: number;
}

/** A world-space point (out-param target — reused per frame, zero alloc). */
export interface WorldPoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/**
 * Un-project a canvas/screen point to world coords through the letterbox
 * `base` (world container) then the `cam` (cameraRoot). Pass `out` to avoid
 * allocation in the pointer handler.
 */
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  base: { x: number; y: number; scale: number },
  cam: CamView,
  out?: WorldPoint,
): WorldPoint {
  const o = out ?? { x: 0, y: 0 };
  o.x = ((canvasX - base.x) / base.scale - cam.x) / cam.scale;
  o.y = ((canvasY - base.y) / base.scale - cam.y) / cam.scale;
  return o;
}

/** Total canvas-px-per-world-unit through both transforms (for touch radii). */
export function worldScale(base: { scale: number }, cam: { scale: number }): number {
  return base.scale * cam.scale;
}

/**
 * Screen-y center of an enemy's tap ellipse. `footY` = the entity's on-screen
 * ground/foot y AFTER terrain + depth lift; `depthScl` = its depth scale. With
 * everything OFF (footY = GROUND_Y, depthScl = 1) → GROUND_Y − 14·size (today).
 */
export function enemyTapCenterY(size: number, footY: number, depthScl: number): number {
  return footY - TAP_CENTER_RISE_PER_SIZE * size * depthScl;
}

/** World-boss tap center = its base center-y plus the terrain lift at its x. */
export function worldBossTapCenterY(baseCY: number, lift: number): number {
  return baseCY + lift;
}

/**
 * R4 Wave C2 — INVERT a tap's world-y into a depth-row `planeY` (the value a
 * `moveTo{x,y}` intent carries). `planeY` is exactly the offset `depthBand.depthOffsetY`
 * ADDS on top of the ground line (`screenWorldY = groundY + depthOffsetY(d)`), so the
 * inverse is simply `worldY − groundY`, CLAMPED to the band's `[far, near]` envelope
 * (a tap above/below the band saturates to the edge row — same clamp the engine re-applies
 * at intake, owner reminder #1). Pure (only −, clamp); no new constants — the band edges
 * are `depthBand`'s own forward-map endpoints, so this exactly inverts `depthOffsetY`.
 * The caller passes the un-projected world-y from `canvasToWorld` + the render `GROUND_Y`.
 */
export function tapToPlaneY(worldY: number, groundY: number, far: number, near: number): number {
  const offset = worldY - groundY;
  return Math.max(far, Math.min(near, offset));
}
