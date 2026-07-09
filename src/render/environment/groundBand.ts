/**
 * The static ground band: base fill + a lighter top strip (depth cue) + a
 * bright top-edge highlight line + baked-in speckle texture. Built once per
 * biome activation — texture is static; scrolling foreground detail lives in
 * the near `ParallaxLayer` (`groundProps.ts`), not here.
 *
 * W3 "โลกมีมิติ" ground-layer promotion adds two terrain-tracking siblings,
 * used ONLY when `BiomeScene` decides a zone's resolved terrain is genuinely
 * non-flat (see that file's doc comment) — `buildGroundBand` above stays the
 * exact flat-zone/terrain-off path, byte-identical to before:
 *   - `buildGroundPolygon` — the same base/band/highlight layering as
 *     `buildGroundBand`, except every edge traces `terrain.groundY(x)`
 *     instead of holding a constant y (mirrors `/lab` experiment ⑨'s
 *     `redrawGroundPoly`, `src/lab/experiments/worldDepth.tsx`).
 *   - `buildGroundBackingStrip` — the "sky-sliver guard": silhouette chunks
 *     only fill ~60% below their own baseline (`silhouettes.ts`), so a valley
 *     dip in the polygon's top edge can expose empty background between the
 *     silhouette's bottom edge and the polygon's top edge. A single flat,
 *     darkened-far-color strip spanning the whole width, added just BEHIND
 *     the polygon, plugs that gap with zero per-frame cost — everywhere the
 *     polygon already covers it, it simply paints over the strip.
 */

import { Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import { adjustLightness } from "@/render/environment/colorUtils";
import type { Terrain } from "@/render/worldDepth/terrain";
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

/** Sample a terrain's ground line into a flat `[x0,y0,x1,y1,...]` list over
 * `[x, x+width]` every `step` px, ALWAYS including the exact right edge (same
 * end-inclusive contract as `Terrain.polyline`) — pure, no Pixi, so it's
 * cheaply unit-testable against `terrain.groundY` directly. `terrain.groundY`
 * clamps internally to its own zone width, so sampling past it (the -MARGIN/
 * +MARGIN letterbox buffer `BiomeScene` draws into) simply extends the
 * nearest edge height flatly — the same over-draw the flat band already does. */
export function sampleGroundLine(terrain: Terrain, x: number, width: number, step: number): number[] {
  const s = Math.max(1, step);
  const right = x + width;
  const pts: number[] = [];
  for (let sx = x; sx < right; sx += s) pts.push(sx, terrain.groundY(sx));
  pts.push(right, terrain.groundY(right));
  return pts;
}

/** Non-flat-terrain sibling of `buildGroundBand`: identical base/band/
 * highlight/speckle layering, except every edge traces `terrain.groundY(x)`
 * (via `sampleGroundLine`) instead of holding a constant y. The highlight
 * line is an OPEN stroked poly (not a fill) — the sanctioned `poly().stroke()`
 * idiom for a many-point curve (see `heroView.ts`'s `arcFanPoints()` call
 * sites / CLAUDE.md footgun 2), never a flat rect, since the top edge isn't
 * flat here. Built once per biome activation, same as `buildGroundBand`. */
export function buildGroundPolygon(
  biome: BiomeDef,
  terrain: Terrain,
  x: number,
  groundY: number,
  width: number,
  depth: number,
  step: number,
): Graphics {
  const g = new Graphics();
  const bandDepth = safeRadius(depth);
  const bandH = Math.min(10, bandDepth);
  const bottom = groundY + bandDepth;
  const top = sampleGroundLine(terrain, x, width, step);

  // Base fill: the top trace closed down to the flat band bottom.
  const basePoly = top.slice();
  basePoly.push(x + width, bottom, x, bottom);
  g.poly(basePoly, true).fill(biome.ground.base);

  // Lighter top-band strip (depth cue): forward trace + the same trace
  // reversed and shifted down `bandH`, closed into one polygon.
  const bandPoly = top.slice();
  for (let i = top.length - 2; i >= 0; i -= 2) {
    bandPoly.push(top[i]!, top[i + 1]! + bandH);
  }
  g.poly(bandPoly, true).fill({ color: biome.ground.band, alpha: 0.7 });

  // Crisp top-edge highlight — open stroke along the same trace.
  g.poly(top, false).stroke({ color: biome.ground.band, alpha: 0.9, width: 1.5 });

  // Baked, non-scrolling speckle texture — same recipe as `buildGroundBand`,
  // just seeded off each speckle's OWN terrain height so it hugs the slope.
  const speckleCount = Math.round(width / 14);
  for (let i = 0; i < speckleCount; i++) {
    const sx = x + Math.random() * width;
    const sy = terrain.groundY(sx) + 6 + Math.random() * (bandDepth - 8);
    g.circle(sx, sy, safeRadius(0.8 + Math.random() * 1.2)).fill({
      color: biome.ground.speckle,
      alpha: 0.25 + Math.random() * 0.25,
    });
  }

  return g;
}

/** The "sky-sliver guard" — see module doc comment. A single flat, near-
 * opaque, darkened-far-color rect spanning `[x, x+width]` at a fixed
 * `groundY-2 .. groundY+10` band, added BEHIND `buildGroundPolygon`'s own
 * fill so it only ever shows through in a dip where the polygon's top edge
 * sinks below the silhouette layer's own bottom edge — everywhere else the
 * polygon paints over it. Zero per-frame cost (built once, like every other
 * ground layer here). */
export function buildGroundBackingStrip(
  biome: BiomeDef,
  x: number,
  groundY: number,
  width: number,
): Graphics {
  const g = new Graphics();
  const top = groundY - 2;
  const bottom = groundY + 10;
  g.rect(x, top, width, safeRadius(bottom - top)).fill({
    color: adjustLightness(biome.far.color, -0.15),
    alpha: 0.95,
  });
  return g;
}
