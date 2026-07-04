/**
 * Near-layer scrolling ground props (grass tufts / rocks / crystals / embers)
 * — one `Graphics` per chunk, built ONCE by `ParallaxLayer`'s `build`
 * callback, matching the pattern in `silhouettes.ts`. Chunk-local y=0 is the
 * ground band's top edge; positive y sinks into the band.
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

/** Build one near-layer ground-props chunk for `biome`. Called once per
 * chunk, never per frame. */
export function buildGroundPropsChunk(opts: GroundPropsChunkOptions): Graphics {
  const g = new Graphics();
  const { chunkWidth, bandDepth, biome } = opts;
  const baseY = Math.min(10, bandDepth * 0.4);
  const accent = biome.ground.accent;

  switch (biome.id) {
    case "meadow": {
      const n = propCount(chunkWidth, 5);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        grassTuft(g, x, baseY + Math.random() * 4, accent);
      }
      break;
    }
    case "forest": {
      const n = propCount(chunkWidth, 2.4);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        bushClump(g, x, baseY + 4 + Math.random() * 4, accent);
      }
      break;
    }
    case "cave": {
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
    case "volcanic": {
      const n = propCount(chunkWidth, 2.4);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        emberRock(g, x, baseY + 8 + Math.random() * 4, accent);
      }
      break;
    }
    case "frost": {
      const n = propCount(chunkWidth, 2.2);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * chunkWidth;
        crystalShard(g, x, baseY + 10 + Math.random() * 3, accent);
      }
      break;
    }
    default:
      break;
  }
  return g;
}
