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
 *   - idle beat: |vx| < IDLE_VX_EPS sustained > IDLE_DELAY eases zoom toward
 *     cam.idleZoom ("the world breathes"); any movement eases back to zoomBase.
 *     Lab: idleZoom 0.92 < zoomBase 1 (breathe out). Game: idleZoom 1.0 <
 *     zoomBase 1.06 (follow tight, relax to the full view when idle);
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
/** Default idle "breathe out" zoom level (lab feel) — used when `createCamera`
 * is called without an `idleZoom` opt; per-camera value lives on `CameraState`. */
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
  /** Zoom the camera eases toward after sustained stillness (idle beat).
   * Lab default 0.92 = "breathe OUT" on a wide world; the game passes 1.0
   * (INVERTED: follow at zoomBase 1.06, ease to the full-view 1.0 when idle —
   * a 900px world can't zoom below 1.0 without revealing the letterbox void). */
  idleZoom: number;
  /** Smoothed lead offset in world px. */
  lookahead: number;
  /** Seconds the target has been standing still. */
  idleT: number;
  /** World width in world px (clamp bounds). */
  worldW: number;
  /** Punch impulse ∈ [0,1]: 1 right after punchZoom(), exp-decays to 0. */
  punch: number;
  /**
   * World px of the visible VIEW at zoom 1 (R2.5 "Game Screen" W1) — defaults
   * to `WORLD_WIDTH` (900), matching every existing caller (`/lab` + the
   * game before this task) byte-identically. The game feeds its LIVE
   * `viewWorldW` (`layout.ts`'s `computeFullscreenTransform`) via
   * `setViewW()` on resize: on a screen wider than the world's own 3:1
   * aspect, more than 900 world-units are already visible at once (decorative
   * bleed either side — see `render/environment/`), so `clampX`'s "is the
   * whole world already in view" check must widen with it, or a fullscreen
   * wide screen would keep panning as if it were still letterboxed.
   */
  viewW: number;
}

/**
 * `opts` are optional so the `/lab` experiment's `createCamera(worldW)` stays
 * bit-identical (defaults zoomBase 1, idleZoom 0.92 = the shipped lab feel).
 * The game passes `{ zoomBase: 1.06, idleZoom: 1.0 }`.
 */
export function createCamera(
  worldW: number,
  opts?: { zoomBase?: number; idleZoom?: number; viewW?: number },
): CameraState {
  const zoomBase = opts?.zoomBase ?? 1;
  const idleZoom = opts?.idleZoom ?? IDLE_ZOOM;
  const viewW = opts?.viewW ?? WORLD_WIDTH;
  return {
    x: clampX(worldW / 2, worldW, zoomBase, viewW),
    zoom: zoomBase,
    zoomBase,
    idleZoom,
    lookahead: 0,
    idleT: 0,
    worldW,
    punch: 0,
    viewW,
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

/** Clamp a center-x so the half-view never crosses a world edge. `viewW`
 * generalizes the "screen width" reference (world px at zoom 1) — see
 * `CameraState.viewW`'s doc comment; every pre-existing call site passes
 * `WORLD_WIDTH` via a default `viewW`, byte-identical to before this param
 * existed. */
function clampX(x: number, worldW: number, zoom: number, viewW: number): number {
  const halfView = viewW / (2 * zoom);
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

  // Idle beat → ambient zoom goal (per-camera idleZoom, defaulted from the knob).
  cam.idleT = Math.abs(target.vx) < IDLE_VX_EPS ? cam.idleT + step : 0;
  const zoomGoal = cam.idleT > IDLE_DELAY ? cam.idleZoom : cam.zoomBase;
  cam.zoom += (zoomGoal - cam.zoom) * damp(ZOOM_K, step);

  // Punch impulse decay (blended in via effectiveZoom, so it dies smoothly).
  cam.punch *= Math.exp(-PUNCH_DECAY_K * step);
  if (cam.punch < PUNCH_EPS) cam.punch = 0;

  // Never show past the world's edges at the zoom we'll render with.
  cam.x = clampX(cam.x, cam.worldW, effectiveZoom(cam), cam.viewW);
}

/**
 * R2.5 "Game Screen" W1: update the live view width (world px at zoom 1) and
 * re-clamp immediately so a resize can't leave `cam.x` stale past an edge for
 * even one frame. `GameRenderer` calls this every resize with the fullscreen
 * `viewWorldW` (`layout.ts`'s `computeFullscreenTransform`); `/lab` never
 * calls it, so its camera stays at the `WORLD_WIDTH` default forever
 * (byte-identical to before this function existed).
 */
export function setViewW(cam: CameraState, v: number): void {
  cam.viewW = v;
  cam.x = clampX(cam.x, cam.worldW, effectiveZoom(cam), cam.viewW);
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
 * DELIBERATELY still `WORLD_WIDTH / 2` here (NOT `cam.viewW / 2`), even
 * though `viewW` now varies with the fullscreen aspect (R2.5 W1): `cameraRoot`
 * is a CHILD of `world`, and `world`'s own base transform independently
 * centers its fixed 900-wide local space on the physical screen for every
 * aspect ratio (`layout.ts`'s `computeFullscreenTransform` keeps that exact
 * `x` formula) — world-local `WORLD_WIDTH/2` (450) is provably the ONE value
 * that lands on physical screen-center at any scale. Swapping in `cam.viewW`
 * here would shift the followed target off-center by `(viewW-900)/2` world
 * units on any screen wider than the world's own 3:1 aspect (`viewW` only
 * generalizes `clampX`'s "does the whole world already fit in view" check
 * above, not this centering term).
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
