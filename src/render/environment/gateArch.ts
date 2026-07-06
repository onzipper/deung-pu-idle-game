/**
 * Zone-edge gate archway (M7.5 "ประตูคือตัวกลาง" — walking transitions pass
 * THROUGH a gate): a small, per-biome-family themed prop at each farm/town
 * zone's LEFT/RIGHT edge (`zoneGates.ts`'s `gateX`). Built ONCE per zone entry
 * (like `bossArena.ts`'s pillars), fixed screen position — NOT part of the
 * scrolling `ParallaxLayer` — since every zone shares the same edge x today
 * (`fieldWidth` is 900 for every configured map).
 *
 * Scenery palette (desaturated, flat-alpha layers) per the binding art
 * direction — these are STRUCTURE, not combat juice, so they stay in the
 * biome's own tones (`ground.band`/`ground.accent`/`far.glowRim`), never a
 * jewel-tone accent. No gradients, no `arc().fill()` (every curve here is a
 * `roundRect`/`poly`/`circle`, all footgun-2/3-safe primitives), every
 * radius/size run through `safeRadius()`.
 */

import { Container, Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import type { GateFamily } from "@/render/environment/zoneGates";
import { safeRadius } from "@/render/theme";

const POST_WIDTH = 14;
const POST_HEIGHT = 66;
const POST_GAP = 46; // clear space between the two posts (the "walk-through" width)
const LINTEL_HEIGHT = 14;

/** Build ONE themed archway `Container`, already positioned at `(x, groundY)`
 * in the biome scene's local space (y=0 at ground, negative = up) — caller
 * just `addChild()`s it once. `family` picks the prop vocabulary; `biome`
 * supplies the actual color values so a hue-loop repeat still matches. */
export function buildZoneGateArch(
  family: GateFamily,
  x: number,
  groundY: number,
  biome: BiomeDef,
): Container {
  const view = new Container();
  view.position.set(x, groundY);

  switch (family) {
    case "map2":
      buildDemonArch(view, biome);
      break;
    case "map3":
      buildFrontierArch(view, biome);
      break;
    case "town":
      buildTownGate(view, biome);
      break;
    default:
      buildHumanArch(view, biome);
      break;
  }
  return view;
}

function postX(side: "left" | "right"): number {
  return side === "left" ? -(POST_GAP / 2 + POST_WIDTH) : POST_GAP / 2;
}

/** map1 — humble carved-stone/timber archway, rounded top. */
function buildHumanArch(view: Container, biome: BiomeDef): void {
  const accent = biome.far.glowRim ?? biome.ground.accent;
  for (const side of ["left", "right"] as const) {
    const g = new Graphics();
    const px = postX(side);
    g.roundRect(px, -POST_HEIGHT, safeRadius(POST_WIDTH), safeRadius(POST_HEIGHT), 3).fill({
      color: biome.ground.band,
      alpha: 0.85,
    });
    // A couple of seam lines (carved-stone courses), same layered-alpha
    // shading vocabulary `bossArena.ts`'s pillars use.
    for (let i = 1; i < 3; i++) {
      const y = -POST_HEIGHT + (POST_HEIGHT / 3) * i;
      g.rect(px, y, safeRadius(POST_WIDTH), 2).fill({ color: biome.ground.speckle, alpha: 0.5 });
    }
    view.addChild(g);
  }
  const lintel = new Graphics();
  const w = POST_GAP + POST_WIDTH * 2 + 8;
  lintel
    .roundRect(-w / 2, -POST_HEIGHT - LINTEL_HEIGHT, safeRadius(w), safeRadius(LINTEL_HEIGHT + 10), 10)
    .fill({ color: biome.ground.band, alpha: 0.85 });
  // Keystone accent, dead center.
  const kw = 10;
  lintel
    .poly([0, -POST_HEIGHT - LINTEL_HEIGHT - 4, kw / 2, -POST_HEIGHT - LINTEL_HEIGHT + 6, 0, -POST_HEIGHT - LINTEL_HEIGHT + 12, -kw / 2, -POST_HEIGHT - LINTEL_HEIGHT + 6], true)
    .fill({ color: accent, alpha: 0.6 });
  view.addChild(lintel);
}

/** map2 — jagged, horn-topped demon-realm arch; reddish glow accent. */
function buildDemonArch(view: Container, biome: BiomeDef): void {
  const accent = biome.far.glowRim ?? biome.ground.accent;
  for (const side of ["left", "right"] as const) {
    const g = new Graphics();
    const sign = side === "left" ? -1 : 1;
    const px = postX(side);
    // Jagged trapezoid post, narrower at the base (reads as gnarled/organic).
    const top = -POST_HEIGHT;
    const pts =
      sign < 0
        ? [px, top, px + POST_WIDTH, top, px + POST_WIDTH + 3, 0, px - 2, 0]
        : [px, top, px + POST_WIDTH, top, px + POST_WIDTH + 2, 0, px - 3, 0];
    g.poly(pts, true).fill({ color: biome.ground.band, alpha: 0.88 });
    g.poly(pts, true).stroke({ width: 1, color: 0x0a0507, alpha: 0.6 });
    view.addChild(g);
  }
  // Two curved horns meeting near the top center — sampled points forming a
  // gentle inward curve (poly, never a bare `arc()`).
  const horns = new Graphics();
  const hornPts = (sign: number): number[] => {
    const base = postX(sign < 0 ? "left" : "right") + (sign < 0 ? POST_WIDTH : 0);
    const pts: number[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = -POST_HEIGHT - t * 30;
      const x = base + sign * (10 + t * t * 26);
      pts.push(x, y);
    }
    // Widen back down for a filled sliver.
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const y = -POST_HEIGHT - t * 30;
      const x = base + sign * (16 + t * t * 26);
      pts.push(x, y);
    }
    return pts;
  };
  horns.poly(hornPts(-1), true).fill({ color: biome.ground.speckle, alpha: 0.9 });
  horns.poly(hornPts(1), true).fill({ color: biome.ground.speckle, alpha: 0.9 });
  // Glow rim where the horns nearly touch.
  horns.circle(0, -POST_HEIGHT - 28, safeRadius(6)).fill({ color: accent, alpha: 0.45 });
  view.addChild(horns);
}

/** map3 — rough frontier wood gate: plank posts + a diagonal rope brace +
 * a plain top beam (utilitarian, no rounded arch). */
function buildFrontierArch(view: Container, biome: BiomeDef): void {
  const accent = biome.ground.accent;
  for (const side of ["left", "right"] as const) {
    const g = new Graphics();
    const px = postX(side);
    g.rect(px, -POST_HEIGHT, safeRadius(POST_WIDTH), safeRadius(POST_HEIGHT)).fill({
      color: biome.ground.band,
      alpha: 0.85,
    });
    for (let i = 1; i < 4; i++) {
      const y = -POST_HEIGHT + (POST_HEIGHT / 4) * i;
      g.rect(px, y, safeRadius(POST_WIDTH), 1.5).fill({ color: biome.ground.speckle, alpha: 0.45 });
    }
    view.addChild(g);
  }
  const beam = new Graphics();
  const w = POST_GAP + POST_WIDTH * 2;
  beam.rect(-w / 2, -POST_HEIGHT - 8, safeRadius(w), safeRadius(8)).fill({
    color: biome.ground.band,
    alpha: 0.85,
  });
  // Diagonal rope brace (two crossing lines) — reads as "lashed together".
  beam
    .moveTo(-w / 2 + 4, -6)
    .lineTo(w / 2 - 4, -POST_HEIGHT + 8)
    .stroke({ width: 2, color: accent, alpha: 0.4 });
  beam
    .moveTo(w / 2 - 4, -6)
    .lineTo(-w / 2 + 4, -POST_HEIGHT + 8)
    .stroke({ width: 2, color: accent, alpha: 0.4 });
  view.addChild(beam);
}

/** Town — warm, welcoming lantern-post gate. */
function buildTownGate(view: Container, biome: BiomeDef): void {
  const warm = biome.ground.accent;
  for (const side of ["left", "right"] as const) {
    const g = new Graphics();
    const px = postX(side);
    g.rect(px, -POST_HEIGHT, safeRadius(POST_WIDTH), safeRadius(POST_HEIGHT)).fill({
      color: biome.ground.band,
      alpha: 0.85,
    });
    // Lantern: a dim outer glow disc + a brighter core, layered alpha only.
    const lx = px + POST_WIDTH / 2;
    const ly = -POST_HEIGHT - 8;
    g.circle(lx, ly, safeRadius(7)).fill({ color: warm, alpha: 0.22 });
    g.circle(lx, ly, safeRadius(3.5)).fill({ color: 0xffe9b8, alpha: 0.85 });
    view.addChild(g);
  }
  const beam = new Graphics();
  const w = POST_GAP + POST_WIDTH * 2;
  beam.rect(-w / 2, -POST_HEIGHT - 6, safeRadius(w), safeRadius(6)).fill({
    color: biome.ground.band,
    alpha: 0.85,
  });
  // A small hanging pennant at center — welcoming detail.
  beam.poly([-6, -POST_HEIGHT + 2, 6, -POST_HEIGHT + 2, 0, -POST_HEIGHT + 16], true).fill({
    color: warm,
    alpha: 0.7,
  });
  view.addChild(beam);
}
