/**
 * Near-layer scrolling ground props (grass tufts / rocks / crystals / embers /
 * town lanterns+NPC silhouettes) — one `Graphics` per chunk, built ONCE by
 * `ParallaxLayer`'s `build` callback, matching the pattern in `silhouettes.ts`.
 * Chunk-local y=0 is the ground band's top edge; positive y sinks into the
 * band.
 *
 * Keyed by `biome.ground.propStyle` (M6 "World & Town"), NOT `biome.id` — many
 * map-specific themed biomes (`map1-zone2`, `map2-zone4`, ...) share the same
 * handful of hand-built prop shapes instead of needing one switch case each.
 */

import { Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import { adjustLightness } from "@/render/environment/colorUtils";
import { safeRadius } from "@/render/theme";

export interface GroundPropsChunkOptions {
  chunkWidth: number;
  bandDepth: number;
  biome: BiomeDef;
}

function propCount(chunkWidth: number, perHundredPx: number): number {
  return Math.max(1, Math.round((chunkWidth / 100) * perHundredPx));
}

function grassTuft(g: Graphics, x: number, y: number, color: number): void {
  for (let i = -1; i <= 1; i++) {
    g.moveTo(x, y)
      .lineTo(x + i * 3, y - 6 - Math.abs(i) * 2)
      .stroke({ width: 1.4, color, cap: "round" });
  }
}

function bushClump(g: Graphics, x: number, y: number, color: number): void {
  g.circle(x, y - 3, safeRadius(4)).fill({ color, alpha: 0.85 });
  g.circle(x - 4, y - 1, safeRadius(3)).fill({ color, alpha: 0.7 });
  g.circle(x + 4, y - 1, safeRadius(3)).fill({ color, alpha: 0.7 });
}

function rockCluster(g: Graphics, x: number, y: number, color: number): void {
  g.poly([x - 6, y, x - 2, y - 7, x + 5, y - 4, x + 7, y, x - 6, y], true).fill(color);
}

function crystalShard(g: Graphics, x: number, y: number, color: number): void {
  const glow = adjustLightness(color, 0.25);
  g.poly([x, y - 12, x + 4, y - 3, x, y, x - 4, y - 3], true).fill({
    color,
    alpha: 0.85,
  });
  g.poly([x, y - 12, x + 2, y - 6, x, y - 3, x - 2, y - 6], true).fill({
    color: glow,
    alpha: 0.6,
  });
}

function emberRock(g: Graphics, x: number, y: number, color: number): void {
  rockCluster(g, x, y, adjustLightness(color, -0.15));
  g.circle(x, y - 5, safeRadius(1.6)).fill({ color, alpha: 0.9 });
}

/** map4 (ice tundra) near layer: a low snow-drift mound — a few overlapping
 * flat-alpha humps (no gradient) plus a thin brighter cap catching the cold
 * light, same layered-alpha vocabulary as `crystalShard`. */
function snowDrift(g: Graphics, x: number, y: number, color: number): void {
  g.poly([x - 8, y, x - 3, y - 5, x + 4, y - 4, x + 8, y], true).fill({ color, alpha: 0.5 });
  g.poly([x - 5, y - 2, x - 1, y - 6, x + 3, y - 5, x + 5, y - 2], true).fill({
    color: adjustLightness(color, 0.15),
    alpha: 0.7,
  });
}

/** map5 (desert ruins) near layer: a broken column/brick chunk lying in the
 * sand — an angular flat-shaded piece with a darker underside, distinct from
 * `rockCluster`'s rounder natural-stone silhouette. */
function rubbleChunk(g: Graphics, x: number, y: number, color: number): void {
  g.poly([x - 6, y, x - 5, y - 8, x + 2, y - 9, x + 6, y - 3, x + 5, y], true).fill({
    color,
    alpha: 0.82,
  });
  g.poly([x - 6, y, x - 5, y - 8, x - 2, y - 6, x - 2, y], true).fill({
    color: adjustLightness(color, -0.25),
    alpha: 0.7,
  });
}

/** map6 (hell city) near layer: a dark ground crack with a thin ember-glow
 * line running along it — the crack itself is near-black, the glow is a
 * separate thin flat-alpha stroke (never a gradient/blur). */
function groundCrack(g: Graphics, x: number, y: number, color: number): void {
  const dark = adjustLightness(color, -0.6);
  g.moveTo(x - 9, y)
    .lineTo(x - 2, y - 3)
    .lineTo(x + 3, y - 1)
    .lineTo(x + 9, y - 4)
    .stroke({ width: 2.4, color: dark, alpha: 0.85 });
  g.moveTo(x - 6, y - 1)
    .lineTo(x - 1, y - 2.6)
    .lineTo(x + 5, y - 2)
    .stroke({ width: 1, color, alpha: 0.6 });
}

/** Town set dressing (M6): a lantern post (dark pole + a warm glowing head,
 * layered flat-alpha — no gradient) reading as "hearth-lit". */
function lanternPost(g: Graphics, x: number, y: number, color: number): void {
  g.rect(x - 1, y - 16, 2, 16).fill({ color: 0x2a2318, alpha: 0.9 });
  g.circle(x, y - 18, safeRadius(3.4)).fill({ color: adjustLightness(color, -0.1), alpha: 0.9 });
  g.circle(x, y - 18, safeRadius(1.8)).fill({ color: adjustLightness(color, 0.3), alpha: 0.95 });
}

/** Town set dressing (M6): a small rounded humanoid silhouette standing still
 * — "real NPCs come with the shops task" per the GDD, this is just ambient
 * set dressing so the hub reads as lived-in. Flat two-tone alpha, no face
 * detail (a silhouette, not a character rig). */
function npcSilhouette(g: Graphics, x: number, y: number, color: number): void {
  const body = adjustLightness(color, -0.55);
  g.circle(x, y - 13, safeRadius(3)).fill({ color: body, alpha: 0.8 }); // head
  g.poly([x - 4, y, x - 3, y - 11, x + 3, y - 11, x + 4, y], true).fill({
    color: body,
    alpha: 0.75,
  }); // simple robe/torso wedge
}

/** Build one near-layer ground-props chunk for `biome`. Called once per
 * chunk, never per frame. */
export function buildGroundPropsChunk(opts: GroundPropsChunkOptions): Graphics {
  const g = new Graphics();
  const { chunkWidth, bandDepth, biome } = opts;
  const baseY = Math.min(10, bandDepth * 0.4);
  const accent = biome.ground.accent;

  switch (biome.ground.propStyle) {
    case "grass": {
      const n = propCount(chunkWidth, 5);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        grassTuft(g, x, baseY + Math.random() * 4, accent);
      }
      break;
    }
    case "bush": {
      const n = propCount(chunkWidth, 2.4);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        bushClump(g, x, baseY + 4 + Math.random() * 4, accent);
      }
      break;
    }
    case "crystal": {
      const n = propCount(chunkWidth, 2.2);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        if (Math.random() < 0.35) {
          crystalShard(g, x, baseY + 12 + Math.random() * 3, accent);
        } else {
          rockCluster(g, x, baseY + 8 + Math.random() * 4, adjustLightness(accent, -0.3));
        }
      }
      break;
    }
    case "ember": {
      const n = propCount(chunkWidth, 2.4);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        emberRock(g, x, baseY + 8 + Math.random() * 4, accent);
      }
      break;
    }
    case "rock": {
      const n = propCount(chunkWidth, 2.2);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        rockCluster(g, x, baseY + 8 + Math.random() * 4, adjustLightness(accent, -0.2));
      }
      break;
    }
    case "snow": {
      const n = propCount(chunkWidth, 2.6);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        snowDrift(g, x, baseY + 6 + Math.random() * 4, accent);
      }
      break;
    }
    case "rubble": {
      const n = propCount(chunkWidth, 2.2);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        rubbleChunk(g, x, baseY + 8 + Math.random() * 4, adjustLightness(accent, -0.15));
      }
      break;
    }
    case "cracks": {
      const n = propCount(chunkWidth, 2.4);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        groundCrack(g, x, baseY + 6 + Math.random() * 4, accent);
      }
      break;
    }
    case "town": {
      // Sparse: a lantern post or two per chunk plus an occasional standing
      // NPC-shaped silhouette — set dressing, not a crowd (real NPCs come
      // with the shops task).
      const lanternCount = propCount(chunkWidth, 1.2);
      for (let i = 0; i < lanternCount; i++) {
        const x = Math.random() * chunkWidth;
        lanternPost(g, x, baseY + 4, accent);
      }
      if (Math.random() < 0.5) {
        npcSilhouette(g, Math.random() * chunkWidth, baseY + 4, accent);
      }
      break;
    }
    default:
      break;
  }
  return g;
}
