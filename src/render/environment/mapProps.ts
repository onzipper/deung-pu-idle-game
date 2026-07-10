/**
 * World props for the Forest Road slice (R4.5 Wave 2C, issue #69) — code-drawn,
 * deterministic decoration for `map2` FARM zones ONLY (see
 * `docs/map-direction.md` "Wave 2 ... World props (Wave 2C)"). Visual-only: no
 * engine state, no collision, no hit-test targets, no image assets — layered
 * flat-alpha primitives per `render/README.md`.
 *
 * Two families:
 *   1. **Standing props** (trees, rocks, a lamp post, a wooden sign, a broken
 *      gate/arch fragment) — each a `Graphics` added DIRECTLY to GameRenderer's
 *      shared `entities` container with a `footY`-derived `zIndex` via the SAME
 *      `depthZIndex(planeToDepth(planeY))` math heroes/enemies/ghosts use (the
 *      Wave-1.2 shared sort domain), so actors walk in front of / behind them.
 *      Placement is applied by GameRenderer's `placeProp` (`place` callback),
 *      keeping the depth/terrain seam in ONE place.
 *   2. **Near layer** (low grass clumps + a thin foreground grass strip) — a
 *      single `Container` with a fixed high `zIndex` (`MAP_PROPS_NEAR_Z`, above
 *      the actor depth band) so it frames the near edge, covering shins at
 *      most. Giving each tuft its own interleave key buys nothing (they all sit
 *      at the near edge and never need an actor to stand in front of one clump),
 *      and one container = fewer display objects. It never occludes damage
 *      numbers / fx — those live in the `fx` layer, which draws ABOVE `entities`
 *      entirely.
 *
 * Placement is a STATELESS hash on (zone id, prop index) via the engine's
 * `hashUnit` — the SAME policy as spawn scatter, NEVER the seeded wave RNG.
 * Every x is clamped into a central band that clears both walk gates (so a prop
 * can never sit inside a gate's tap rect) and is nudged out of the town-NPC
 * anchor ranges. Some props hug the road using `forestRoad.ts`'s exposed
 * `roadCenterXAt`/`roadHalfWidthAt`. STATIC + build-once: everything is drawn
 * when the zone changes and never touched per frame.
 *
 * Binding art rules (`render/README.md`): layered flat alpha ONLY — no
 * gradients, no filters, no additive blend. `Graphics.arc().fill()` is the
 * footgun — every curve here is a `circle`/`rect`/`roundRect`/`poly` (all
 * footgun-2/3-safe), and every radius/size runs through `safeRadius()`. Colors
 * derive from the biome palette + `PALETTE.outline`/`shade` vocabulary; the two
 * warm lamp-glow constants are COLORS (not positions) — no new absolute
 * positions exist (all derive from band/layout/gate/road values).
 */

import { Container, Graphics } from "pixi.js";
import { hashUnit, type Zone } from "@/engine";
import type { BiomeDef } from "@/render/environment/biomes";
import { adjustLightness, lerpColor } from "@/render/environment/colorUtils";
import { roadCenterXAt, roadHalfWidthAt } from "@/render/environment/forestRoad";
import { gateX } from "@/render/environment/zoneGates";
import { DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR } from "@/render/worldDepth/depthBand";
import { WORLD_WIDTH } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";
import { TOWN_NPCS } from "@/render/townNpcs";

/** Pixi `label` on each standing prop `Graphics` (prefixed by kind) + the near
 * layer container — lets tests assert props are present in a map2 farm scene
 * and absent elsewhere without reaching into geometry. */
export const MAP_PROP_LABEL_PREFIX = "mapProp:";
export const MAP_PROPS_NEAR_LABEL = "mapPropsNear";

/**
 * `zIndex` for the near-layer container — ABOVE the actor depth band (max
 * `depthZIndex` is 1000, see `depthBand.ts`) so the foreground grass frames the
 * near edge in front of every walking actor, but BELOW the fixed stage-boss key
 * (+10000, `GameRenderer`) so it never covers the boss. Not a position — a sort
 * key.
 */
export const MAP_PROPS_NEAR_Z = 2000;

// ---------------------------------------------------------------------------
// Counts + placement knobs (counts / fractions / px sizes — NOT absolute screen
// positions; every world x derives live from the gate edges + road path).
// ---------------------------------------------------------------------------

const TREE_MIN = 4;
const TREE_MAX = 6;
const ROCK_MIN = 3;
const ROCK_MAX = 4;
/** Grass-clump count bounds — exported so the R4.5 Wave 2D cross-zone density
 * guard (`wave2dReadability.test.ts`) can pin the full inventory range
 * without duplicating the literal (mirrors `GRASS_D_MIN`/`GRASS_D_MAX`
 * already being exported for the same reason). */
export const GRASS_MIN = 6;
export const GRASS_MAX = 10;
/** Clearance (world px) each prop keeps from BOTH walk gates — comfortably over
 * `zoneGates.DEFAULT_GATE_TAP_HALF_W` (30) so a prop x can never land inside a
 * gate's tap rect (verified by the no-tap test). */
const GATE_CLEAR = 48;
/** Near-half depth rows the low grass clumps scatter across (0 = far, 1 = near). */
export const GRASS_D_MIN = 0.6;
export const GRASS_D_MAX = 0.98;
/** Foreground grass strip: how tall a blade tip rises above the near foot line,
 * and how deep the filled ground-cover band sinks below it (world px). Kept a
 * shin's worth — the strip covers feet/shins of the nearest actors at most. */
const TUFT_MAX_H = 12;
const STRIP_DEPTH = 8;
/** Two warm gold COLORS for the lamp flat-glow halo (colors, not positions —
 * a gold glow is inherently warm; mirrors `gateArch.ts`'s town lantern). */
const LAMP_GLOW = 0xffcf6a;
const LAMP_CORE = 0xfff0c0;

export type MapPropKind = "tree" | "rock" | "lamp" | "sign" | "gateFragment";

export interface MapPropSpec {
  kind: MapPropKind;
  /** World-x foot position (gate-cleared, NPC-nudged). */
  x: number;
  /** Depth d ∈ [0,1] (0 far, 1 near) — `planeToDepth(planeY)`. */
  d: number;
  /** Engine-style plane y-offset; `place()` inverts it via `planeToDepth` so
   * the prop rides the EXACT `depthZIndex(planeToDepth(planeY))` an actor does. */
  planeY: number;
  /** Per-prop size multiplier (hash-varied). */
  size: number;
  /** Extra [0,1) hash for shape variety. */
  variant: number;
}

export interface MapGrassSpec {
  x: number;
  /** Near-half depth row [GRASS_D_MIN, GRASS_D_MAX]. */
  d: number;
  variant: number;
}

export interface MapPropLayout {
  standing: MapPropSpec[];
  grass: MapGrassSpec[];
}

/** The gate this slice targets: `map2` FARM zones only (the forest biome
 * family, matching `forestRoadActiveForZone` in 2B). Every other map/zone
 * returns false → no props are ever built there (byte-identical). */
export function mapPropsActiveForZone(zone: Zone): boolean {
  return zone.mapId === "map2" && zone.kind === "farm";
}

// ---------------------------------------------------------------------------
// Pure placement (headlessly unit-testable — NO Pixi here)
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Stable per-(zone, tag) hash ∈ [0,1) — the same stateless policy as spawn
 * scatter (`hashUnit`), NEVER the seeded wave RNG. */
function h(zone: Zone, tag: string): number {
  return hashUnit(`map2prop:${zone.mapId}:${zone.zoneIdx}:${tag}`);
}

/** Inclusive integer in [lo, hi] from a hash. */
function hInt(zone: Zone, tag: string, lo: number, hi: number): number {
  return lo + Math.min(hi - lo, Math.floor(h(zone, tag) * (hi - lo + 1)));
}

/** Per-kind depth-row band (composition: fragments upstage, lamp/sign
 * downstage, trees/rocks across). */
function propDepth(zone: Zone, kind: MapPropKind, tag: string): number {
  const u = h(zone, `${tag}:d`);
  switch (kind) {
    case "gateFragment":
      return lerp(0.08, 0.4, u);
    case "lamp":
    case "sign":
      return lerp(0.5, 0.9, u);
    case "rock":
      return lerp(0.2, 0.85, u);
    default:
      return lerp(0.15, 0.9, u); // tree
  }
}

/** Shift `x` out of any forbidden interval (town-NPC anchor ranges), staying in
 * `[lo, hi]` — deterministic (nearest clear edge). A few passes handle adjacent
 * intervals. */
function nudgeClear(x: number, forbidden: readonly (readonly [number, number])[], lo: number, hi: number): number {
  let cx = clampN(x, lo, hi);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const [a, b] of forbidden) {
      if (cx > a && cx < b) {
        const left = a - 2;
        const right = b + 2;
        const preferLeft = cx - a < b - cx;
        cx = preferLeft
          ? left >= lo
            ? left
            : right
          : right <= hi
            ? right
            : left;
        cx = clampN(cx, lo, hi);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return cx;
}

/**
 * The full deterministic prop layout for a map2 farm zone — PURE (no Pixi). Same
 * zone → identical layout across calls (hash-only). Every standing x sits in the
 * central gate-cleared band and clears the town-NPC anchor ranges; the first two
 * trees + the sign hug the road edge (`roadCenterXAt`). Grass clumps scatter the
 * near-half rows.
 */
export function mapPropLayout(zone: Zone): MapPropLayout {
  const gl = gateX(zone.mapId, "left");
  const gr = gateX(zone.mapId, "right");
  const safeLeft = gl + GATE_CLEAR;
  const safeRight = gr - GATE_CLEAR;
  const forbidden = TOWN_NPCS.map((n) => [n.x - n.radius, n.x + n.radius] as const);

  const nTree = hInt(zone, "treeN", TREE_MIN, TREE_MAX);
  const nRock = hInt(zone, "rockN", ROCK_MIN, ROCK_MAX);

  const kinds: MapPropKind[] = [];
  for (let i = 0; i < nTree; i++) kinds.push("tree");
  for (let i = 0; i < nRock; i++) kinds.push("rock");
  kinds.push("lamp", "sign", "gateFragment");
  const total = kinds.length;

  const standing: MapPropSpec[] = [];
  let treeSeen = 0;
  for (let i = 0; i < total; i++) {
    const kind = kinds[i]!;
    const tag = `${kind}:${i}`;
    const d = propDepth(zone, kind, tag);
    const planeY = DEPTH_OFFSET_FAR + (DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR) * d;
    const size = 0.85 + 0.4 * h(zone, `${tag}:size`);
    const variant = h(zone, `${tag}:var`);

    // Road-following: the first two trees + the sign hug the road edge; the
    // rest spread across evenly-jittered slots.
    const roadSide = (kind === "tree" && treeSeen < 2) || kind === "sign";
    if (kind === "tree") treeSeen++;
    let x: number;
    if (roadSide) {
      const side = h(zone, `${tag}:side`) < 0.5 ? -1 : 1;
      const clear = roadHalfWidthAt(d) + 6 + 6 * h(zone, `${tag}:clr`);
      x = roadCenterXAt(d) + side * clear;
    } else {
      const slotC = lerp(safeLeft, safeRight, (i + 0.5) / total);
      const slotW = (safeRight - safeLeft) / total;
      x = slotC + (h(zone, `${tag}:jit`) - 0.5) * slotW * 0.7;
    }
    x = nudgeClear(clampN(x, safeLeft, safeRight), forbidden, safeLeft, safeRight);
    standing.push({ kind, x, d, planeY, size, variant });
  }

  const nGrass = hInt(zone, "grassN", GRASS_MIN, GRASS_MAX);
  const grass: MapGrassSpec[] = [];
  for (let i = 0; i < nGrass; i++) {
    const tag = `grass:${i}`;
    const x = clampN(
      lerp(safeLeft, safeRight, (i + 0.5) / nGrass) + (h(zone, `${tag}:jit`) - 0.5) * 40,
      safeLeft,
      safeRight,
    );
    const d = lerp(GRASS_D_MIN, GRASS_D_MAX, h(zone, `${tag}:d`));
    grass.push({ x, d, variant: h(zone, `${tag}:v`) });
  }

  return { standing, grass };
}

/** Vertical extent of the foreground grass strip at a flat ground line — pure,
 * for the geometry-bound test. Stays inside the depth band's near half (top at
 * the near foot line minus a blade tip, bottom a shallow ground-cover depth). */
export function foregroundStripBand(groundY0: number): { top: number; bottom: number } {
  const near = groundY0 + DEPTH_OFFSET_NEAR;
  return { top: near - TUFT_MAX_H, bottom: near + STRIP_DEPTH };
}

// ---------------------------------------------------------------------------
// Build (Pixi) — standing props (each its own Graphics) + one near-layer
// Container. Built once on zone change; the caller applies `place` + `addChild`.
// ---------------------------------------------------------------------------

function drawTree(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  const s = spec.size;
  const trunkH = 34 * s;
  const trunkW = 7 * s;
  const trunkCol = adjustLightness(lerpColor(biome.ground.speckle, biome.ground.base, 0.5), -0.04);
  const trunkPts = [-trunkW * 0.5, 0, trunkW * 0.5, 0, trunkW * 0.34, -trunkH, -trunkW * 0.34, -trunkH];
  g.poly(trunkPts, true).fill({ color: trunkCol, alpha: 0.95 });
  g.poly(trunkPts, true).stroke({ width: 1, color: PALETTE.outline, alpha: 0.5 });

  const cy = -trunkH - 6 * s;
  const cr = 15 * s * (0.9 + 0.2 * spec.variant);
  const canopy = lerpColor(biome.far.color, biome.ground.band, 0.55);
  const canopyLit = adjustLightness(canopy, 0.12);
  g.circle(0, cy, safeRadius(cr)).fill({ color: canopy, alpha: 0.95 });
  g.circle(-cr * 0.7, cy + 3 * s, safeRadius(cr * 0.72)).fill({ color: canopy, alpha: 0.9 });
  g.circle(cr * 0.7, cy + 3 * s, safeRadius(cr * 0.72)).fill({ color: canopy, alpha: 0.9 });
  g.circle(0, cy - cr * 0.5, safeRadius(cr * 0.7)).fill({ color: canopy, alpha: 0.9 });
  g.circle(-cr * 0.35, cy - cr * 0.3, safeRadius(cr * 0.5)).fill({ color: canopyLit, alpha: 0.6 });
  g.circle(0, cy, safeRadius(cr)).stroke({ width: 1, color: PALETTE.outline, alpha: 0.32 });
}

function drawRock(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  const s = spec.size * 1.3;
  const col = adjustLightness(biome.ground.base, 0.03);
  const lit = adjustLightness(col, 0.14);
  const pts = [-9 * s, 0, -6 * s, -7 * s, 1 * s, -9 * s, 7 * s, -5 * s, 9 * s, 0];
  g.poly(pts, true).fill({ color: col, alpha: 0.95 });
  g.poly(pts, true).stroke({ width: 1, color: PALETTE.outline, alpha: 0.5 });
  g.poly([-6 * s, -7 * s, 1 * s, -9 * s, 0, -5 * s, -4 * s, -5 * s], true).fill({ color: lit, alpha: 0.6 });
}

function drawLamp(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  const s = spec.size;
  const poleH = 40 * s;
  const poleCol = adjustLightness(biome.ground.base, -0.1);
  g.rect(-1.5, -poleH, 3, poleH).fill({ color: poleCol, alpha: 0.95 });
  g.rect(-1.5, -poleH, 3, poleH).stroke({ width: 1, color: PALETTE.outline, alpha: 0.5 });
  const hy = -poleH - 2;
  // Flat-alpha halo discs (outer → inner), NO additive blend.
  g.circle(0, hy, safeRadius(11 * s)).fill({ color: LAMP_GLOW, alpha: 0.12 });
  g.circle(0, hy, safeRadius(7.5 * s)).fill({ color: LAMP_GLOW, alpha: 0.2 });
  g.circle(0, hy, safeRadius(4.6 * s)).fill({ color: LAMP_GLOW, alpha: 0.4 });
  g.circle(0, hy, safeRadius(2.6 * s)).fill({ color: LAMP_CORE, alpha: 0.95 });
  // Thin lantern frame + top cap.
  g.rect(-3 * s, hy - 5 * s, safeRadius(6 * s), safeRadius(10 * s)).stroke({ width: 1, color: poleCol, alpha: 0.8 });
  g.rect(-4 * s, hy - 6 * s, safeRadius(8 * s), 2).fill({ color: poleCol, alpha: 0.9 });
}

function drawSign(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  const s = spec.size;
  const postH = 30 * s;
  const wood = adjustLightness(lerpColor(biome.ground.speckle, biome.ground.base, 0.4), 0.02);
  g.rect(-1.6, -postH, 3.2, postH).fill({ color: wood, alpha: 0.95 });
  const bw = 26 * s;
  const bh = 14 * s;
  const by = -postH - 2;
  g.roundRect(-bw / 2, by - bh, safeRadius(bw), safeRadius(bh), 2).fill({ color: wood, alpha: 0.95 });
  g.roundRect(-bw / 2, by - bh, safeRadius(bw), safeRadius(bh), 2).stroke({
    width: 1,
    color: PALETTE.outline,
    alpha: 0.5,
  });
  g.rect(-bw / 2 + 2, by - bh + bh * 0.5, safeRadius(bw - 4), 1).fill({
    color: adjustLightness(wood, -0.12),
    alpha: 0.6,
  });
}

function drawGateFragment(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  const s = spec.size;
  const band = biome.ground.band;
  const speckle = biome.ground.speckle;
  const accent = biome.far.glowRim ?? biome.ground.accent;
  const ph = 46 * s;
  const pw = 13 * s;
  const lean = 3 * s; // a broken, leaning post — the map2 demon-arch language
  const postPts = [
    -pw / 2,
    0,
    pw / 2,
    0,
    pw / 2 + lean,
    -ph * 0.66,
    pw / 2 + lean - 2,
    -ph * 0.72,
    -pw / 2 + lean - 1,
    -ph * 0.6,
  ];
  g.poly(postPts, true).fill({ color: band, alpha: 0.9 });
  g.poly(postPts, true).stroke({ width: 1, color: PALETTE.outline, alpha: 0.55 });
  // A jagged horn stub near the break (demon-arch vocabulary, `gateArch.ts`).
  g.poly([pw / 2 + lean - 4, -ph * 0.62, pw / 2 + lean + 6, -ph * 0.78, pw / 2 + lean, -ph * 0.6], true).fill({
    color: speckle,
    alpha: 0.9,
  });
  g.circle(pw / 2 + lean - 1, -ph * 0.68, safeRadius(3.4 * s)).fill({ color: accent, alpha: 0.4 });
  // Rubble at the base.
  g.poly([-pw / 2 - 6 * s, 0, -pw / 2 - 2 * s, -4 * s, -pw / 2 + 2 * s, -2 * s, -pw / 2 + 5 * s, 0], true).fill({
    color: adjustLightness(band, -0.1),
    alpha: 0.85,
  });
}

function drawStandingProp(g: Graphics, biome: BiomeDef, spec: MapPropSpec): void {
  switch (spec.kind) {
    case "tree":
      drawTree(g, biome, spec);
      break;
    case "rock":
      drawRock(g, biome, spec);
      break;
    case "lamp":
      drawLamp(g, biome, spec);
      break;
    case "sign":
      drawSign(g, biome, spec);
      break;
    case "gateFragment":
      drawGateFragment(g, biome, spec);
      break;
  }
}

/** Build the near-layer container (low grass clumps + full-width foreground
 * strip). Children are drawn in WORLD coords (the container sits at the entities
 * origin); `groundYAt` bakes any terrain slope. `zIndex` frames the near edge. */
function buildNearLayer(
  biome: BiomeDef,
  grass: MapGrassSpec[],
  groundYAt: (x: number) => number,
): Container {
  const near = new Container();
  near.label = MAP_PROPS_NEAR_LABEL;
  near.zIndex = MAP_PROPS_NEAR_Z;

  const grassCol = adjustLightness(biome.ground.band, 0.05);
  const grassTip = adjustLightness(biome.ground.accent, -0.1);

  // Full-width foreground ground-cover strip at the near foot line (sampled
  // poly — footgun-2 safe; a filled band, then a thin lighter top edge).
  const strip = new Graphics();
  const steps = 24;
  const topEdge: number[] = [];
  const botEdge: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (WORLD_WIDTH / steps) * i;
    const near0 = groundYAt(x) + DEPTH_OFFSET_NEAR;
    topEdge.push(x, near0);
    botEdge.push(x, near0 + STRIP_DEPTH);
  }
  const band: number[] = [...topEdge];
  for (let i = botEdge.length - 2; i >= 0; i -= 2) band.push(botEdge[i]!, botEdge[i + 1]!);
  strip.poly(band, true).fill({ color: adjustLightness(grassCol, -0.06), alpha: 0.55 });
  strip.poly(topEdge, false).stroke({ width: 1.5, color: grassCol, alpha: 0.5 });
  near.addChild(strip);

  // Low grass clumps scattered across the near-half rows.
  const tufts = new Graphics();
  for (const cl of grass) {
    const y = groundYAt(cl.x) + DEPTH_OFFSET_FAR + (DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR) * cl.d;
    const hgt = 6 + TUFT_MAX_H * (0.4 + 0.6 * cl.variant);
    for (let i = -1; i <= 1; i++) {
      tufts
        .moveTo(cl.x, y)
        .lineTo(cl.x + i * 3, y - hgt * (i === 0 ? 1 : 0.7))
        .stroke({ width: 1.4, color: i === 0 ? grassTip : grassCol, cap: "round" });
    }
  }
  near.addChild(tufts);

  return near;
}

export interface MapPropsBuilt {
  /** Standing props (aligned with `layout.standing`) — added DIRECTLY to
   * `entities`, each placed by `place`. */
  standing: Graphics[];
  /** The near-layer container — added to `entities` with its fixed `zIndex`. */
  near: Container;
  layout: MapPropLayout;
}

/**
 * Build the whole 2C prop set for one map2 farm zone. The caller
 * (`GameRenderer`) has already checked `mapPropsActiveForZone(zone)`.
 * `groundYAt` is the shared world-fx ground sampler (terrain-aware, flat when
 * off); `place(view, spec)` applies the depth/terrain foot-plant + `zIndex`
 * (kept in `GameRenderer` so the seam lives in one place). Standing props are
 * returned un-parented (caller `addChild`s them into `entities` so they share
 * the actor sort domain); the near container is returned ready to add.
 */
export function buildMapProps(
  biome: BiomeDef,
  zone: Zone,
  groundYAt: (x: number) => number,
  place: (view: Graphics, spec: MapPropSpec) => void,
): MapPropsBuilt {
  const layout = mapPropLayout(zone);
  const standing: Graphics[] = [];
  for (const spec of layout.standing) {
    const g = new Graphics();
    g.label = MAP_PROP_LABEL_PREFIX + spec.kind;
    drawStandingProp(g, biome, spec);
    place(g, spec);
    standing.push(g);
  }
  const near = buildNearLayer(biome, layout.grass, groundYAt);
  return { standing, near, layout };
}
