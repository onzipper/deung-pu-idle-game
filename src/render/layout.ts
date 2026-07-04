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
 */
export function computeWorldTransform(screenW: number, screenH: number): WorldTransform {
  const w = Math.max(1, screenW);
  const h = Math.max(1, screenH);
  const scale = Math.max(0.0001, Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT));
  const x = (w - WORLD_WIDTH * scale) / 2;
  const y = (h - WORLD_HEIGHT * scale) / 2;
  return { scale, x, y };
}
