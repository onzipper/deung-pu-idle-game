/**
 * Forest Road ground composition (R4.5 Wave 2B, issue #69) — the authored
 * ground layer for `map2` FARM zones only (see `docs/map-direction.md`
 * "Wave 2 — Forest Outskirts / Dark Forest Road vertical slice"). Turns the
 * playable band from one flat fill into a read-able field:
 *
 *   1. **Depth tone strips** — 3 horizontal flat-alpha strips across the depth
 *      band's own screen envelope (`GROUND_Y + DEPTH_OFFSET_FAR..NEAR`, derived
 *      from `worldDepth/depthBand.ts` — NO new absolute-position constants).
 *      Far strip darkest, near lightest; every tone is a `darken`/`lerp` of the
 *      biome's OWN `ground.base`/`ground.band` palette (no new hex literals).
 *   2. **Dirt-road S-curve** — crosses the band far-left -> near-right, drawn as
 *      layered flat-alpha polygon segments (perspective-widening near the
 *      camera) with an edge highlight from `ground.accent`. Fades toward the
 *      zone's walk gates, mirroring `terrainZone.ts`'s gate-flattening idea.
 *
 * Binding art rules (`render/README.md`): layered flat alpha ONLY — no
 * gradients, no filters, no additive blend. Everything here is STATIC (nothing
 * animates): built ONCE when the biome scene builds / the zone changes, then
 * never touched again per frame (`BiomeScene` never calls back into it).
 *
 * Gating lives in `forestRoadActiveForZone` and is enforced at the single
 * `BiomeScene` composition site — every other map/zone (town, boss, map1,
 * map3+, asura) renders byte-identical (this module is simply never built).
 */

import { Container, Graphics } from "pixi.js";
import type { Zone } from "@/engine";
import type { BiomeDef } from "@/render/environment/biomes";
import { adjustLightness, lerpColor } from "@/render/environment/colorUtils";
import { DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR } from "@/render/worldDepth/depthBand";
import type { Terrain } from "@/render/worldDepth/terrain";
import { gateX } from "@/render/environment/zoneGates";
import { WORLD_WIDTH } from "@/render/layout";
import { safeRadius } from "@/render/theme";

/** The Pixi `label` on the built container — lets tests assert the composition
 * is present in a map2 farm scene and absent everywhere else without reaching
 * into geometry. */
export const FOREST_ROAD_LABEL = "forestRoad";

/**
 * The gate this slice targets: `map2` FARM zones only ("forest biome family"
 * per the Wave-2 spec). Town / boss / every other map returns false, so the
 * composition is never built there and those scenes stay byte-identical.
 */
export function forestRoadActiveForZone(zone: Zone): boolean {
  return zone.mapId === "map2" && zone.kind === "farm";
}

// ---------------------------------------------------------------------------
// Knobs (px fractions / counts — NOT absolute screen positions; the band's
// own y-envelope is derived live from the depth-band offsets below).
// ---------------------------------------------------------------------------

/** How many depth tone strips span the band (spec: 2-3). */
const STRIP_COUNT = 3;
/** Road path: far/near end x as a fraction of the field width, and the lateral
 * S-curve sway amplitude (fraction of field width). */
const ROAD_FAR_X_FRAC = 0.14;
const ROAD_NEAR_X_FRAC = 0.86;
const ROAD_SWAY_FRAC = 0.09;
/** Road half-width in world px at the far (upstage, narrow) and near
 * (downstage, wide) ends — the perspective taper. */
const ROAD_HALF_W_FAR = 20;
const ROAD_HALF_W_NEAR = 76;
/** Vertical segment count the road is stacked from (build-once, static). */
const ROAD_SEGMENTS = 12;
/** Half-width (px) of the ease from a gate out to the road's full alpha —
 * mirrors `terrainZone.ts`'s `GATE_FLATTEN_PX` gate-flattening idea (the road
 * FADES here rather than flattening the ground line). */
const ROAD_GATE_FADE_PX = 90;

// ---------------------------------------------------------------------------
// Pure geometry / color (headlessly unit-testable — no Pixi here)
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Classic smoothstep on an already-[0,1] argument (0 slope at both ends) —
 * same shape `terrainZone.ts` uses for its gate envelope. */
function smoothstep01(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export interface ForestRoadStrip {
  /** Screen y of the strip's top edge. */
  top: number;
  /** Strip height (px). */
  height: number;
  /** Flat fill color (derived from the biome palette — see below). */
  color: number;
  /** Flat fill alpha. */
  alpha: number;
}

/**
 * The 3 depth tone strips, as pure data. Geometry spans EXACTLY the depth
 * band's screen envelope `[groundY + DEPTH_OFFSET_FAR, groundY +
 * DEPTH_OFFSET_NEAR]` (derived from `depthBand.ts` — no new constants). Color
 * lerps from a DARKENED `ground.base` (far strip = darkest) toward the lighter
 * `ground.band` depth-cue tone (near strip), so far is always darker than near
 * (test-pinned). `x`/`width` are the full ground span (bleed-inclusive).
 */
export function forestRoadStrips(biome: BiomeDef, groundY: number): ForestRoadStrip[] {
  const bandTop = groundY + DEPTH_OFFSET_FAR;
  const bandHeight = DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR;
  const stripH = bandHeight / STRIP_COUNT;
  const farTone = adjustLightness(biome.ground.base, -0.12);
  const strips: ForestRoadStrip[] = [];
  for (let i = 0; i < STRIP_COUNT; i++) {
    const frac = i / (STRIP_COUNT - 1); // 0 = far, 1 = near
    strips.push({
      top: bandTop + stripH * i,
      height: stripH,
      color: lerpColor(farTone, biome.ground.band, frac),
      alpha: lerp(0.34, 0.2, frac), // far strip a touch more opaque
    });
  }
  return strips;
}

/** Gate-fade multiplier for a road center-x — smoothstep of distance to the
 * NEAREST gate over `ROAD_GATE_FADE_PX`. 0 at a gate (road fully faded), 1 once
 * clear of both. Exported for a direct unit test (no Pixi). */
export function roadGateFadeAt(cx: number, gateLeft: number, gateRight: number): number {
  const dist = Math.min(Math.abs(cx - gateLeft), Math.abs(cx - gateRight));
  return smoothstep01(dist / ROAD_GATE_FADE_PX);
}

/** Road center x at path parameter t (0 = far/upstage, 1 = near/downstage):
 * a left->right sweep plus a lateral sine sway for the S. */
function roadCenterX(t: number, farX: number, nearX: number, sway: number): number {
  return lerp(farX, nearX, t) + sway * Math.sin(t * Math.PI * 1.4);
}

/** Road half-width at t — perspective taper (far narrow -> near wide). */
function roadHalfWidth(t: number): number {
  return lerp(ROAD_HALF_W_FAR, ROAD_HALF_W_NEAR, t);
}

// ---------------------------------------------------------------------------
// Build (Pixi) — one Container, built once
// ---------------------------------------------------------------------------

/**
 * Build the whole forest-road ground composition for one map2 farm zone. The
 * caller (`BiomeScene`) has already checked `forestRoadActiveForZone(zone)`.
 * `stripX`/`stripWidth` are the biome's full (bleed-inclusive) ground span;
 * the road itself is laid out over the walkable field `[0, WORLD_WIDTH]`. When
 * `terrain` is supplied (a non-flat farm zone) the road rows hug the slope via
 * `terrain.groundY`; otherwise everything sits on the flat `groundY`.
 */
export function buildForestRoad(
  biome: BiomeDef,
  zone: Zone,
  groundY: number,
  stripX: number,
  stripWidth: number,
  terrain?: Terrain,
): Container {
  const root = new Container();
  root.label = FOREST_ROAD_LABEL;

  // --- 1. Depth tone strips (horizontal, full-width). ---
  const stripG = new Graphics();
  for (const s of forestRoadStrips(biome, groundY)) {
    stripG.rect(stripX, s.top, stripWidth, safeRadius(s.height)).fill({ color: s.color, alpha: s.alpha });
  }
  root.addChild(stripG);

  // --- 2. Dirt-road S-curve (layered flat-alpha polygon segments). ---
  const bandTop = groundY + DEPTH_OFFSET_FAR;
  const bandHeight = DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR;
  const farX = WORLD_WIDTH * ROAD_FAR_X_FRAC;
  const nearX = WORLD_WIDTH * ROAD_NEAR_X_FRAC;
  const sway = WORLD_WIDTH * ROAD_SWAY_FRAC;
  const gateLeft = gateX(zone.mapId, "left");
  const gateRight = gateX(zone.mapId, "right");

  // Road body tone: a warmer/lighter dirt read midway between base and band.
  const roadColor = adjustLightness(lerpColor(biome.ground.base, biome.ground.band, 0.5), 0.05);
  const rutColor = adjustLightness(roadColor, -0.07);

  // Precompute each row's center/half-width/y/fade once.
  const rows: { cx: number; hw: number; y: number; fade: number }[] = [];
  for (let j = 0; j <= ROAD_SEGMENTS; j++) {
    const t = j / ROAD_SEGMENTS;
    const cx = roadCenterX(t, farX, nearX, sway);
    const baseY = bandTop + bandHeight * t;
    const y = terrain ? baseY + (terrain.groundY(cx) - groundY) : baseY;
    rows.push({ cx, hw: roadHalfWidth(t), y, fade: roadGateFadeAt(cx, gateLeft, gateRight) });
  }

  const roadG = new Graphics();
  const rutG = new Graphics();
  for (let j = 0; j < ROAD_SEGMENTS; j++) {
    const a = rows[j]!;
    const b = rows[j + 1]!;
    const fade = Math.min(a.fade, b.fade); // fully faded if either end sits in a gate
    if (fade <= 0.001) continue;
    // Body trapezoid: a's edges -> b's edges.
    roadG
      .poly([a.cx - a.hw, a.y, a.cx + a.hw, a.y, b.cx + b.hw, b.y, b.cx - b.hw, b.y])
      .fill({ color: roadColor, alpha: 0.85 * fade });
    // Narrower center rut for a little worn depth (still flat alpha).
    const ar = a.hw * 0.42;
    const br = b.hw * 0.42;
    rutG
      .poly([a.cx - ar, a.y, a.cx + ar, a.y, b.cx + br, b.y, b.cx - br, b.y])
      .fill({ color: rutColor, alpha: 0.35 * fade });
  }
  root.addChild(roadG, rutG);

  // --- 3. Edge highlights (open strokes along both road edges, ground.accent). ---
  const leftEdge: number[] = [];
  const rightEdge: number[] = [];
  for (const r of rows) {
    leftEdge.push(r.cx - r.hw, r.y);
    rightEdge.push(r.cx + r.hw, r.y);
  }
  const edgeG = new Graphics();
  edgeG.poly(leftEdge, false).stroke({ color: biome.ground.accent, alpha: 0.4, width: 1.5 });
  edgeG.poly(rightEdge, false).stroke({ color: biome.ground.accent, alpha: 0.4, width: 1.5 });
  root.addChild(edgeG);

  return root;
}
