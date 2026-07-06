/**
 * Boss-room arena framing (M6 "World & Town", ROADMAP task 2 "ห้องบอสต้องดูพิเศษ").
 *
 * A boss room already gets its own dedicated, darker/more-intense `BiomeDef`
 * per map (`biomes.ts`'s `*_BOSS` entries — never a reuse of the last farm
 * zone) with denser ember/mist particles. This module adds the EXTRA "this is
 * a PLACE, not just a darker palette" read the task calls for: two flanking
 * gate pillars + a lintel (built once, fixed screen position — NOT part of
 * the scrolling `ParallaxLayer`, so the "gate" never drifts out of frame),
 * plus a stepped-alpha vignette darkening the arena's edges. Everything here
 * is flat-alpha layered rects/polys (POC-bug rule: no gradients) and every
 * radius/size is a plain positive literal (nothing derived that could go
 * negative, so no `safeRadius()` call sites are needed here — kept anyway on
 * the one size that comes from a biome field, for defense-in-depth).
 *
 * Built once per `BiomeScene` activation (see `BiomeScene.ts`), destroyed
 * with it — never rebuilt per frame.
 */

import { Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import { safeRadius } from "@/render/theme";

const PILLAR_WIDTH = 26;
const PILLAR_INSET = 18; // px from each screen edge
const VIGNETTE_STEPS = 4;
const VIGNETTE_MAX_ALPHA = 0.35;
const VIGNETTE_WIDTH = 110;

function buildPillar(x: number, groundY: number, worldHeight: number, biome: BiomeDef): Graphics {
  const g = new Graphics();
  const top = -20;
  const height = groundY - top + 20;
  const accent = biome.far.glowRim ?? biome.ground.accent;

  // Shaft.
  g.rect(x, top, PILLAR_WIDTH, height).fill({ color: biome.ground.band, alpha: 0.9 });
  // A couple of stacked seam lines (armor-plate-style flat shading, not a
  // gradient) so the pillar reads as carved stone, not a flat block.
  const seams = 4;
  for (let i = 1; i < seams; i++) {
    const y = top + (height / seams) * i;
    g.rect(x, y, PILLAR_WIDTH, 2).fill({ color: biome.ground.speckle, alpha: 0.5 });
  }
  // Accent-lit inner edge (the "boss-colored accent lighting" the task asks
  // for) — a thin bright strip facing the arena center.
  g.rect(x + PILLAR_WIDTH - 3, top, 3, height).fill({ color: accent, alpha: 0.55 });
  void worldHeight;
  return g;
}

function buildLintel(worldWidth: number, biome: BiomeDef): Graphics {
  const g = new Graphics();
  const y = -14;
  const h = 16;
  const accent = biome.far.glowRim ?? biome.ground.accent;
  g.rect(PILLAR_INSET, y, worldWidth - PILLAR_INSET * 2, h).fill({
    color: biome.ground.band,
    alpha: 0.55,
  });
  g.rect(PILLAR_INSET, y + h - 2, worldWidth - PILLAR_INSET * 2, safeRadius(2)).fill({
    color: accent,
    alpha: 0.4,
  });
  return g;
}

/** Stepped-alpha edge darkening (left/right strips) — a cheap, gradient-free
 * vignette that frames the arena without touching the readable center where
 * combat happens. */
function buildVignette(worldWidth: number, worldHeight: number): Graphics {
  const g = new Graphics();
  const stepW = VIGNETTE_WIDTH / VIGNETTE_STEPS;
  for (let i = 0; i < VIGNETTE_STEPS; i++) {
    const alpha = (VIGNETTE_MAX_ALPHA * (VIGNETTE_STEPS - i)) / VIGNETTE_STEPS;
    const w = safeRadius(stepW);
    g.rect(i * stepW, -20, w, worldHeight + 40).fill({ color: 0x000000, alpha });
    g.rect(worldWidth - (i + 1) * stepW, -20, w, worldHeight + 40).fill({
      color: 0x000000,
      alpha,
    });
  }
  return g;
}

/** Builds the full boss-room framing (pillars + lintel + vignette) as one
 * `Graphics`-bearing set added directly to `BiomeScene.view` (fixed screen
 * position, never scrolled). Only called when `biome.special === "bossRoom"`. */
export function buildBossArenaFraming(
  biome: BiomeDef,
  worldWidth: number,
  worldHeight: number,
  groundY: number,
): Graphics[] {
  const left = buildPillar(PILLAR_INSET, groundY, worldHeight, biome);
  const right = buildPillar(worldWidth - PILLAR_INSET - PILLAR_WIDTH, groundY, worldHeight, biome);
  const lintel = buildLintel(worldWidth, biome);
  const vignette = buildVignette(worldWidth, worldHeight);
  return [vignette, left, right, lintel];
}
