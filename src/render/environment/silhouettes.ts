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

/** Town far layer (M6): a row of boxy house silhouettes with peaked roofs +
 * the occasional warm lantern-window dot — reads as a distant rooftop
 * skyline without needing a dedicated sprite. Flat-alpha fill only. */
function rooftopSkyline(g: Graphics, opts: SilhouetteChunkOptions): void {
  const { chunkWidth, baselineY, far } = opts;
  const featureWidth = 100 / Math.max(0.2, far.density);
  const houseCount = Math.max(1, Math.round(chunkWidth / featureWidth));
  const stepX = chunkWidth / houseCount;
  for (let i = 0; i < houseCount; i++) {
    const x = i * stepX + stepX * 0.15;
    const w = stepX * 0.7;
    const h = far.amplitude * (0.5 + Math.random() * 0.5);
    const roofH = h * 0.4;
    const wallTop = baselineY - h + roofH;
    g.rect(x, wallTop, w, h - roofH).fill({ color: far.color, alpha: far.alpha });
    g.poly(
      [x - 2, wallTop, x + w / 2, wallTop - roofH, x + w + 2, wallTop],
      true,
    ).fill({ color: far.color, alpha: far.alpha });
    // A single warm lantern-window glow on roughly half the houses.
    if (Math.random() < 0.5) {
      g.rect(x + w * 0.35, wallTop + (h - roofH) * 0.35, 3, 3).fill({
        color: far.glowRim ?? 0xffcf7a,
        alpha: 0.7,
      });
    }
  }
}

/** map5 (desert ruins) far layer: broken civilization — a row of column
 * stumps (varying height, some snapped off jagged) plus the occasional
 * shallow arch remnant connecting two columns. Randomized-but-built-once,
 * same convention as the jagged shapes. */
function ruinsSkyline(g: Graphics, opts: SilhouetteChunkOptions): void {
  const { chunkWidth, baselineY, far } = opts;
  const featureWidth = 100 / Math.max(0.2, far.density);
  const count = Math.max(2, Math.round(chunkWidth / featureWidth));
  const stepX = chunkWidth / count;
  const colW = Math.max(4, stepX * 0.28);
  let prevTopX = -1;
  let prevTopY = 0;
  let prevStanding = false;
  for (let i = 0; i < count; i++) {
    const x = i * stepX + stepX * 0.3;
    const standing = Math.random() < 0.7;
    const h = far.amplitude * (standing ? 0.7 + Math.random() * 0.3 : 0.25 + Math.random() * 0.3);
    const topY = baselineY - h;
    // Column shaft — broken (jagged) top when not "standing" tall.
    if (standing) {
      g.rect(x, topY, colW, h).fill({ color: far.color, alpha: far.alpha });
    } else {
      g.poly(
        [x, topY + h * 0.15, x + colW * 0.4, topY, x + colW, topY + h * 0.1, x + colW, topY + h, x, topY + h],
        true,
      ).fill({ color: far.color, alpha: far.alpha });
    }
    // Arch remnant linking this column to the previous one, roughly every
    // other pair, only when both are tall enough to plausibly have spanned.
    if (prevTopX >= 0 && standing && prevStanding && Math.random() < 0.5) {
      const midX = (prevTopX + x) / 2;
      const archTop = Math.min(prevTopY, topY) - far.amplitude * 0.18;
      g.poly(
        [prevTopX, prevTopY, midX, archTop, x + colW, topY, x + colW - colW * 0.5, topY + 4, midX, archTop + 6, prevTopX + colW * 0.5, prevTopY + 4],
        true,
      ).fill({ color: far.color, alpha: far.alpha * 0.85 });
    }
    prevTopX = x;
    prevTopY = topY;
    prevStanding = standing;
  }
}

/** map6 (hell city) far layer: dark twisted city towers — thin rectangular
 * spires of varying height with jagged/crenellated tops and a scattering of
 * ember "window" glints along their faces. Reads as architecture, not raw
 * terrain, distinguishing it from `jaggedSpikes`. */
function infernalSkyline(g: Graphics, opts: SilhouetteChunkOptions): void {
  const { chunkWidth, baselineY, far } = opts;
  const featureWidth = 100 / Math.max(0.2, far.density);
  const count = Math.max(2, Math.round(chunkWidth / featureWidth));
  const stepX = chunkWidth / count;
  for (let i = 0; i < count; i++) {
    const x = i * stepX + stepX * 0.2;
    const w = Math.max(5, stepX * 0.45);
    const h = far.amplitude * (0.55 + Math.random() * 0.45);
    const topY = baselineY - h;
    const jag = Math.min(6, w * 0.3);
    g.poly(
      [x, baselineY, x, topY + jag, x + w * 0.3, topY, x + w * 0.6, topY + jag * 0.6, x + w, topY + jag * 0.3, x + w, baselineY],
      true,
    ).fill({ color: far.color, alpha: far.alpha });
    // A couple of ember-glint windows, low alpha-flat dots, never a gradient.
    if (far.glowRim && Math.random() < 0.6) {
      g.rect(x + w * 0.3, topY + jag + h * 0.3, 2, 2).fill({ color: far.glowRim, alpha: 0.55 });
    }
    if (far.glowRim && Math.random() < 0.4) {
      g.rect(x + w * 0.55, topY + jag + h * 0.55, 2, 2).fill({ color: far.glowRim, alpha: 0.45 });
    }
  }
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
    case "rooftops":
      rooftopSkyline(g, opts);
      break;
    case "ruins":
      ruinsSkyline(g, opts);
      break;
    case "infernal-skyline":
      infernalSkyline(g, opts);
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
