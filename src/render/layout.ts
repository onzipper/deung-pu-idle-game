/**
 * Logical (world) coordinate space + screen-fit scaling.
 *
 * The engine's spatial constants (`CONFIG.layout`, `CONFIG.spawnX`, etc.) define
 * a coordinate space up to ~900 wide with the ground at `CONFIG.layout.groundY`
 * (POC-faithful). We render into a fixed-size `world` Container in that logical
 * space and letterbox/scale it to whatever pixel size the Pixi canvas actually
 * is — so drawing code never has to think about device pixels or container
 * size, and resizing the page never requires rebuilding the scene.
 */

import { CONFIG } from "@/engine/config";

/** Logical world width in engine units (spawnX=860 plus a small margin). */
export const WORLD_WIDTH = 900;

/** Logical world height in engine units (ground + headroom above/below it). */
export const WORLD_HEIGHT = 300;

/** Ground line, straight from engine config — the single source of truth. */
export const GROUND_Y = CONFIG.layout.groundY;

export interface WorldTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Compute the scale + centering offset that fits `WORLD_WIDTH x WORLD_HEIGHT`
 * inside an arbitrary `screenW x screenH` pixel area (letterboxed, never
 * cropped, never upscaled to a negative/zero size).
 *
 * Kept exactly as-is (never touched by the R2.5 "Game Screen" fullscreen work
 * below) — `/lab` experiments and headless tests build against this directly,
 * and it's the byte-identical baseline `computeFullscreenTransform` collapses
 * to at exactly the world's own 3:1 aspect.
 */
export function computeWorldTransform(screenW: number, screenH: number): WorldTransform {
  const w = Math.max(1, screenW);
  const h = Math.max(1, screenH);
  const scale = Math.max(0.0001, Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT));
  const x = (w - WORLD_WIDTH * scale) / 2;
  const y = (h - WORLD_HEIGHT * scale) / 2;
  return { scale, x, y };
}

// ---------------------------------------------------------------------------
// R2.5 "Game Screen" W1 — fullscreen (any-aspect-ratio) canvas fit.
//
// The logical world stays a fixed 900x300 box (GROUND_Y unchanged, entities/
// hit-tests/engine-adjacent math untouched — world-space tests pin it). A
// fullscreen MMO-style view additionally wants the canvas to look FILLED at
// any aspect ratio, not letterboxed with dead bars — so on top of the same
// fit-scale as `computeWorldTransform`, this adds:
//   - a vertical anchor bias (`BAND_BIAS`) so the 900x300 "playfield band"
//     sits slightly BELOW center on tall/narrow screens (sky headroom above,
//     a touch more ground below), instead of dead-center;
//   - `headroom`/`footroom`/`viewWorldW` out-values so the renderer knows how
//     much EXTRA world-space (beyond the 900x300 box) is actually visible on
//     screen, to size decorative sky/ground bleed + the camera clip
//     mask/filter area to match.
// The render layer paints DECORATION into that extra space (`environment/`);
// it is never gameplay-relevant (no entities/hit-tests live out there).
// ---------------------------------------------------------------------------

/** Playfield-band vertical anchor within the fullscreen canvas: 0 = band
 * hugs the screen top, 1 = hugs the bottom, 0.5 = dead-center. 0.58 anchors
 * it slightly BELOW center per the owner's fullscreen-MMO reference. Only
 * has an effect when the screen's aspect is TALLER than the world's own 3:1
 * (i.e. `headroom`/`footroom` are both 0 at/below 3:1 — see
 * `computeFullscreenTransform`). */
export const BAND_BIAS = 0.58;

/** Decorative sky bleed painted above `GROUND_Y` (world px) — fixed knob, not
 * derived from the live screen size. Generous enough for realistic portrait
 * aspects; a genuinely more extreme screen simply reveals the Pixi
 * `Application`'s own flat `backgroundColor` past the bleed edge (the exact
 * same fallback a letterboxed screen already showed for its bars). */
export const SKY_BLEED = 900;
/** Decorative ground-fill bleed painted below the playfield (world px). Same
 * fixed-knob reasoning as `SKY_BLEED`. */
export const GROUND_BLEED = 900;
/** Decorative sky/ground horizontal bleed painted beyond each world x-edge
 * (world px) — fixed knob, same reasoning as `SKY_BLEED`/`GROUND_BLEED`. */
export const BLEED_X = 900;

export interface FullscreenTransform extends WorldTransform {
  /** World px of vertical space ABOVE the 900x300 playfield visible on
   * screen (sky bleed room) — 0 at/below the world's own 3:1 aspect. */
  headroom: number;
  /** World px of vertical space BELOW the playfield visible on screen
   * (ground bleed room) — 0 at/below the world's own 3:1 aspect. */
  footroom: number;
  /** Total world px of HORIZONTAL space visible on screen, symmetric around
   * the playfield's own horizontal center — always `>= WORLD_WIDTH`, equal
   * to it at/below the world's own 3:1 aspect. */
  viewWorldW: number;
}

/**
 * Fullscreen (any-aspect) fit: same `scale`/`x` as `computeWorldTransform`
 * (so `world`'s own local coordinate system — and every entity/hit-test
 * living in it — is completely unaffected), but `y` anchors via `BAND_BIAS`
 * instead of dead-center, plus the `headroom`/`footroom`/`viewWorldW`
 * out-values the renderer uses to size decorative bleed + the camera clip
 * mask/filter area. At exactly the world's own 3:1 aspect this is
 * byte-identical to `computeWorldTransform` (headroom=footroom=0,
 * viewWorldW=WORLD_WIDTH) — see `fullscreenLayout.test.ts`.
 */
export function computeFullscreenTransform(screenW: number, screenH: number): FullscreenTransform {
  const w = Math.max(1, screenW);
  const h = Math.max(1, screenH);
  const scale = Math.max(0.0001, Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT));
  const x = (w - WORLD_WIDTH * scale) / 2;
  const y = (h - WORLD_HEIGHT * scale) * BAND_BIAS;
  const headroom = y / scale;
  const footroom = (h - y - WORLD_HEIGHT * scale) / scale;
  const viewWorldW = w / scale;
  return { scale, x, y, headroom, footroom, viewWorldW };
}

export interface VisibleWorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The full world-space rect actually visible on screen at `screenW x
 * screenH`, generous enough to also cover the fixed decorative bleed knobs
 * (`BLEED_X`) even past whatever `viewWorldW` alone would need — extracted
 * as a pure, headlessly-testable helper because `GameRenderer` feeds this
 * SAME rect to both `world.filterArea` (impact filters) and the living-
 * camera's clip mask, and both must stay in lockstep with each resize.
 */
export function computeVisibleWorldRect(screenW: number, screenH: number): VisibleWorldRect {
  const t = computeFullscreenTransform(screenW, screenH);
  const bleedX = Math.max(BLEED_X, (t.viewWorldW - WORLD_WIDTH) / 2);
  return {
    x: -bleedX,
    y: -t.headroom,
    width: WORLD_WIDTH + bleedX * 2,
    height: WORLD_HEIGHT + t.headroom + t.footroom,
  };
}
