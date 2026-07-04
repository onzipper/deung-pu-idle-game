/**
 * Sky band + horizon glow builders. "Gradient" here means a handful of
 * flat-color rects stacked and lerped (`colorUtils.lerpColor`) — explicitly
 * NOT `CanvasRenderingContext2D.createRadialGradient`/`addColorStop`, which is
 * the exact POC crash this project avoids by construction (render/README).
 * Built once per biome activation; the sky itself does not scroll.
 */

import { Graphics } from "pixi.js";
import { lerpColor } from "@/render/environment/colorUtils";

const SKY_BANDS = 7;

/** Layered-rect sky fill from `top` to `bottom`, spanning the given rect. */
export function buildSkyBands(
  top: number,
  bottom: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Graphics {
  const g = new Graphics();
  const bandH = height / SKY_BANDS;
  for (let i = 0; i < SKY_BANDS; i++) {
    const t = i / (SKY_BANDS - 1);
    const color = lerpColor(top, bottom, t);
    g.rect(x, y + i * bandH, width, bandH + 0.5).fill(color);
  }
  return g;
}

/** A soft horizon-hugging glow band, faded upward via a few decreasing-alpha
 * strips (still flat-fill rects, not a gradient). */
export function buildHorizonGlow(
  color: number,
  x: number,
  width: number,
  horizonY: number,
  height = 46,
): Graphics {
  const g = new Graphics();
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const frac = i / steps;
    const stripH = height / steps;
    const alpha = 0.16 * (1 - frac);
    g.rect(x, horizonY - height + i * stripH, width, stripH + 0.5).fill({
      color,
      alpha,
    });
  }
  return g;
}
