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
