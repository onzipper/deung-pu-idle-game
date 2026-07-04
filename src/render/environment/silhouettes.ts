/**
 * Far-layer silhouette chunk builders — one `Graphics` per chunk, built ONCE
 * by `ParallaxLayer`'s `build` callback and only repositioned thereafter.
 *
 * `rolling-hills` samples a sine wave using each chunk's GLOBAL x offset so
 * adjacent chunks line up seamlessly; the jagged shapes (treeline/jagged-rock/
 * volcanic-ridge/frost-peaks) use randomized-but-built-once features, which
 * hides the occasional seam far better than a smooth curve would.
 */

import { Graphics } from "pixi.js";
import type { BiomeDef, SilhouetteShape } from "@/render/environment/biomes";
import { adjustLightness, lerpColor } from "@/render/environment/colorUtils";

export interface SilhouetteChunkOptions {
  chunkWidth: number;
  /** This chunk's index within the layer — used for seamless sine phase. */
  index: number;
  /** Baseline y (world coords) the silhouette's feet sit on. */
  baselineY: number;
  shape: SilhouetteShape;
  far: BiomeDef["far"];
}

function polyPoints(pts: Array<[number, number]>): number[] {
  return pts.flat();
}

function rollingHills(g: Graphics, opts: SilhouetteChunkOptions): void {
  const { chunkWidth, index, baselineY, far } = opts;
  const samples = 10;
  const depth = far.amplitude * 0.6;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const localX = (i / samples) * chunkWidth;
    const globalX = index * chunkWidth + localX;
    const wave =
      Math.sin(globalX * 0.012) * 0.5 + Math.sin(globalX * 0.005 + 1.3) * 0.5;
    const y = baselineY - far.amplitude * 0.5 - wave * far.amplitude * 0.5;
    pts.push([localX, y]);
  }
  pts.push([chunkWidth, baselineY + depth], [0, baselineY + depth]);
  g.poly(polyPoints(pts), true).fill({ color: far.color, alpha: far.alpha });
}

function jaggedSpikes(
  g: Graphics,
  opts: SilhouetteChunkOptions,
  jaggedness: number,
): void {
  const { chunkWidth, baselineY, far } = opts;
  const featureWidth = 100 / Math.max(0.2, far.density);
  const featureCount = Math.max(2, Math.round(chunkWidth / featureWidth));
  const stepX = chunkWidth / featureCount;
  const depth = far.amplitude * 0.5;

  const pts: Array<[number, number]> = [[0, baselineY]];
  for (let i = 0; i <= featureCount; i++) {
    const x = i * stepX;
    const h = far.amplitude * (1 - jaggedness * 0.35 + Math.random() * jaggedness * 0.35);
    // Alternate peak/valley so the silhouette reads as a jagged ridge rather
    // than a single sawtooth in one direction.
    const valley = i % 2 === 0;
    const y = baselineY - (valley ? h : h * 0.45);
    pts.push([x, y]);
  }
  pts.push([chunkWidth, baselineY], [chunkWidth, baselineY + depth], [0, baselineY + depth]);
  g.poly(polyPoints(pts), true).fill({ color: far.color, alpha: far.alpha });
}

function withGlowRim(g: Graphics, opts: SilhouetteChunkOptions): void {
  // Re-trace just the top edge with a thin, brighter stroke — a cheap "glow"
  // that stays within the "no hand-built gradients" rule (plain stroke on a
  // plain Graphics call, not a filter or a canvas gradient).
  const { far } = opts;
  if (!far.glowRim) return;
  // The fill above already consumed the point list; re-derive a light cap
  // pass is unnecessary for jagged shapes since the fill's own top edge already
  // reads clearly — instead we add a soft duplicate silhouette at low alpha
  // tint to suggest a heat/frost glow without re-walking geometry.
  g.tint = lerpColor(0xffffff, far.glowRim, 0.15);
}

/** Build one far-layer silhouette chunk for `shape`. Called once per chunk,
 * never per frame. */
export function buildSilhouetteChunk(opts: SilhouetteChunkOptions): Graphics {
  const g = new Graphics();
  switch (opts.shape) {
    case "rolling-hills":
      rollingHills(g, opts);
      break;
    case "treeline":
      jaggedSpikes(g, opts, 0.5);
      break;
    case "jagged-rock":
      jaggedSpikes(g, opts, 0.75);
      break;
    case "volcanic-ridge":
      jaggedSpikes(g, opts, 0.9);
      break;
    case "frost-peaks":
      jaggedSpikes(g, opts, 0.85);
      break;
  }
  withGlowRim(g, opts);
  if (opts.shape === "frost-peaks" && opts.far.glowRim) {
    addSnowCaps(g, opts);
  }
  return g;
}

/** Frost biome only: small lighter triangles near each peak tip to read as
 * snow caps, reusing the same randomized feature spacing as the fill pass. */
function addSnowCaps(g: Graphics, opts: SilhouetteChunkOptions): void {
  const { chunkWidth, baselineY, far } = opts;
  const featureWidth = 100 / Math.max(0.2, far.density);
  const featureCount = Math.max(2, Math.round(chunkWidth / featureWidth));
  const stepX = chunkWidth / featureCount;
  const capColor = adjustLightness(far.glowRim ?? far.color, 0.1);
  for (let i = 0; i <= featureCount; i += 2) {
    const x = i * stepX;
    const h = far.amplitude * 0.85;
    const y = baselineY - h;
    g.poly([x - 6, y + 14, x + 6, y + 14, x, y], true).fill({
      color: capColor,
      alpha: far.alpha * 0.8,
    });
  }
}
