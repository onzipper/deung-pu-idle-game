/**
 * Living-camera math for `/lab` experiment ⑨ "โลกมีมิติ" — pure state + math,
 * NO Pixi/DOM. The experiment owns a `cameraRoot` Container and applies
 * `cameraTransform(cam)` to it every frame (stage.ts owns `stage.world`'s
 * letterbox transform, so the camera must live one Container below it).
 *
 * Every smoothed quantity uses the same exponential damp
 *     value += (goal - value) * (1 - exp(-k * dt))
 * which is framerate-independent and can NEVER overshoot (the step factor is
 * always in [0,1)) — no spring constants to tune against 60fps.
 *
 * Behavior (test-enforced in `worldDepthCamera.test.ts`):
 *   - follows target.x + lookahead; lookahead is a smoothed
 *     clamp(vx * LOOKAHEAD_TIME, ±LOOKAHEAD_MAX) so the camera leads a
 *     running hero and settles dead-center when he stops;
 *   - idle beat: |vx| < IDLE_VX_EPS sustained > IDLE_DELAY eases zoom out to
 *     IDLE_ZOOM ("the world breathes"); any movement eases back to zoomBase;
 *   - punchZoom(): zoom kicks to PUNCH_ZOOM then decays exponentially back —
 *     the punch BLENDS over (and therefore wins against) the idle zoom while
 *     active, with no discontinuity as it dies;
 *   - x is clamped so the view NEVER shows past the world's edges, at any
 *     zoom; a world narrower than the view pins to its center.
 */

import { GROUND_Y, WORLD_WIDTH } from "@/render/layout";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Follow stiffness (per second) toward target.x + lookahead. */
const FOLLOW_K = 3;
/** Lookahead = clamp(vx * this, ±LOOKAHEAD_MAX) — "lead the runner" seconds. */
const LOOKAHEAD_TIME = 0.6;
const LOOKAHEAD_MAX = 60;
/** Lookahead smoothing stiffness (per second). */
const LOOKAHEAD_K = 4;

/** |vx| below this counts as standing still. */
const IDLE_VX_EPS = 5;
/** Seconds of stillness before the idle zoom-out starts. */
const IDLE_DELAY = 2;
/** Idle "breathe out" zoom level. */
const IDLE_ZOOM = 0.92;
/** Zoom easing stiffness (per second) toward base/idle goal. */
const ZOOM_K = 2;

/** Punch peak zoom and its exponential decay rate (per second). */
const PUNCH_ZOOM = 1.22;
const PUNCH_DECAY_K = 2.5;
/** Below this the punch impulse snaps to exact 0 (rest state). */
const PUNCH_EPS = 1e-4;

/** Zoom pivot height: zooming breathes around the action band, not y=0. */
const CAMERA_PIVOT_Y = GROUND_Y - 40;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CameraTarget {
  x: number;
  vx: number;
}

export interface CameraState {
  /** World-x the view is centered on (already edge-clamped). */
  x: number;
  /** Smoothed ambient zoom (base/idle easing — punch rides on top). */
  zoom: number;
  /** The "normal play" zoom the camera returns to. */
  zoomBase: number;
  /** Smoothed lead offset in world px. */
  lookahead: number;
  /** Seconds the target has been standing still. */
  idleT: number;
  /** World width in world px (clamp bounds). */
  worldW: number;
  /** Punch impulse ∈ [0,1]: 1 right after punchZoom(), exp-decays to 0. */
  punch: number;
}

export function createCamera(worldW: number): CameraState {
  return {
    x: clampX(worldW / 2, worldW, 1),
    zoom: 1,
    zoomBase: 1,
    lookahead: 0,
    idleT: 0,
    worldW,
    punch: 0,
  };
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/** Framerate-independent smoothing factor — always in [0,1), never overshoots. */
function damp(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/** Blended zoom actually shown on screen: ambient zoom + punch toward peak. */
function effectiveZoom(cam: CameraState): number {
  return cam.zoom + (PUNCH_ZOOM - cam.zoom) * cam.punch;
}

/** Clamp a center-x so the half-view never crosses a world edge. */
function clampX(x: number, worldW: number, zoom: number): number {
  const halfView = WORLD_WIDTH / (2 * zoom);
  if (worldW <= halfView * 2) return worldW / 2;
  return Math.min(worldW - halfView, Math.max(halfView, x));
}

/** Kick the punch impulse to full — call on big beats (boss hit, evolve...). */
export function punchZoom(cam: CameraState): void {
  cam.punch = 1;
}

export function updateCamera(cam: CameraState, target: CameraTarget, dt: number): void {
  const step = Math.max(0, dt);

  // Lookahead: lead the runner, settle to 0 when he stops.
  const lookGoal = Math.max(
    -LOOKAHEAD_MAX,
    Math.min(LOOKAHEAD_MAX, target.vx * LOOKAHEAD_TIME),
  );
  cam.lookahead += (lookGoal - cam.lookahead) * damp(LOOKAHEAD_K, step);

  // Follow.
  cam.x += (target.x + cam.lookahead - cam.x) * damp(FOLLOW_K, step);

  // Idle beat → ambient zoom goal.
  cam.idleT = Math.abs(target.vx) < IDLE_VX_EPS ? cam.idleT + step : 0;
  const zoomGoal = cam.idleT > IDLE_DELAY ? IDLE_ZOOM : cam.zoomBase;
  cam.zoom += (zoomGoal - cam.zoom) * damp(ZOOM_K, step);

  // Punch impulse decay (blended in via effectiveZoom, so it dies smoothly).
  cam.punch *= Math.exp(-PUNCH_DECAY_K * step);
  if (cam.punch < PUNCH_EPS) cam.punch = 0;

  // Never show past the world's edges at the zoom we'll render with.
  cam.x = clampX(cam.x, cam.worldW, effectiveZoom(cam));
}

export interface CameraTransform {
  posX: number;
  posY: number;
  scale: number;
}

/**
 * Pixi-ready transform for the cameraRoot Container:
 *   root.scale = scale; root.position = (posX, posY)
 * posX centers cam.x on screen; posY anchors the zoom around CAMERA_PIVOT_Y
 * (screen-y = worldY*scale + pivotY*(1-scale) keeps the pivot line fixed).
 *
 * Pass `out` from per-frame callers — it is mutated and returned, so the
 * render loop allocates nothing (same out-param convention as heroView's
 * `getSwordTipPos`). Omitting it allocates a fresh object (tests).
 */
export function cameraTransform(cam: CameraState, out?: CameraTransform): CameraTransform {
  const scale = effectiveZoom(cam);
  const o = out ?? { posX: 0, posY: 0, scale: 1 };
  o.posX = WORLD_WIDTH / 2 - cam.x * scale;
  o.posY = CAMERA_PIVOT_Y * (1 - scale);
  o.scale = scale;
  return o;
}
