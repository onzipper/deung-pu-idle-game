/**
 * The static ground band: base fill + a lighter top strip (depth cue) + a
 * bright top-edge highlight line + baked-in speckle texture. Built once per
 * biome activation — texture is static; scrolling foreground detail lives in
 * the near `ParallaxLayer` (`groundProps.ts`), not here.
 */

import { Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import { safeRadius } from "@/render/theme";

export function buildGroundBand(
  biome: BiomeDef,
  x: number,
  groundY: number,
  width: number,
  depth: number,
): Graphics {
  const g = new Graphics();
  const bandDepth = safeRadius(depth);

  g.rect(x, groundY, width, bandDepth).fill(biome.ground.base);
  // Lighter strip along the top edge for a little depth/thickness.
  g.rect(x, groundY, width, Math.min(10, bandDepth)).fill({
    color: biome.ground.band,
    alpha: 0.7,
  });
  // Crisp top-edge highlight line — reads as "where the ground begins".
  g.rect(x, groundY, width, 1.5).fill({ color: biome.ground.band, alpha: 0.9 });

  // Baked, non-scrolling speckle texture (static per activation).
  const speckleCount = Math.round(width / 14);
  for (let i = 0; i < speckleCount; i++) {
    const sx = x + Math.random() * width;
    const sy = groundY + 6 + Math.random() * (bandDepth - 8);
    g.circle(sx, sy, safeRadius(0.8 + Math.random() * 1.2)).fill({
      color: biome.ground.speckle,
      alpha: 0.25 + Math.random() * 0.25,
    });
  }

  return g;
}
