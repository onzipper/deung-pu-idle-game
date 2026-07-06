/**
 * Per-boss silhouette identity (M7.9 "Grand Expansion" — 6 boss stages,
 * s5/10/15/20/25/30, one per `CONFIG.world.maps` entry). Pure data + shape
 * builders, no Pixi `Application`/state — `bossView.ts` is the only caller,
 * and it draws these onto its ALREADY-existing, every-frame-redrawn `body`
 * Graphics (see that module's doc comment for why the body redraws
 * continuously rather than build-once: color pulses with `boss.telegraph`/
 * `boss.enraged`, unchanged by this task). This file only varies WHICH
 * shapes/colors get drawn, keyed by `BossMapId` — no rig/animation rework.
 *
 * Shared vocabulary with `heroView.ts`'s `arcFanPoints()`: any curved cap is
 * point-sampled into an explicit `poly()` — never `Graphics.arc().fill()`
 * (footgun 2, CLAUDE.md #2 — a fill collapses toward the path's stale pen
 * position instead of the arc's own coordinates).
 */

import type { Graphics } from "pixi.js";
import { BOSS_COLORS, type BossMapId } from "@/render/theme";

/** Mirror a flat [x0,y0,x1,y1,...] point list across x=0 (for symmetric
 * left/right silhouette parts authored once as the "right" side). */
function mirrorX(pts: readonly number[]): number[] {
  const out = pts.slice();
  for (let i = 0; i < out.length; i += 2) out[i] = -out[i];
  return out;
}

/** A point-sampled crescent (ring-segment) — the curved-horn/crest primitive
 * used by several themes below. `startDeg`/`endDeg` measured from +x axis,
 * clockwise (Pixi y-down convention), degrees for readability at call sites. */
function crescentPoints(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
  segments = 6,
): number[] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = toRad(startDeg + ((endDeg - startDeg) * i) / segments);
    pts.push(cx + rOuter * Math.cos(a), cy + rOuter * Math.sin(a));
  }
  for (let i = segments; i >= 0; i--) {
    const a = toRad(startDeg + ((endDeg - startDeg) * i) / segments);
    pts.push(cx + rInner * Math.cos(a), cy + rInner * Math.sin(a));
  }
  return pts;
}

export interface BossTheme {
  key: BossMapId;
  /** Idle (non-telegraph/non-enraged) core body fill. */
  bodyColor: number;
  /** Idle crown/horn accent (replaces the old flat `PALETTE.bossLight`). */
  crownColor: number;
  /** Idle eye color (replaces the old flat `PALETTE.bossLight`). */
  eyeColor: number;
  /** Draws the crown/horns onto `g`, in absolute GROUND_Y-relative coords
   * (same pivot convention as the rest of `bossView.ts` — see that module's
   * doc comment). `r`/`cy` mirror the hexagon body's own radius/center;
   * `menaceColor` is whatever `bossView.ts` resolves this frame (idle
   * `crownColor` above, or the universal enrage/telegraph accent). */
  drawCrown: (g: Graphics, r: number, cy: number, menaceColor: number) => void;
  /** Optional additive flourish drawn after the crown — shoulder plates for
   * most themes, but reused by map6 for its molten crack-line accent (same
   * "one extra silhouette/detail layer" slot, different content per theme). */
  drawExtra?: (g: Graphics, r: number, cy: number, color: number) => void;
}

// ---------------------------------------------------------------------------
// map1 s5 — Cave Guardian: the original PROCEDURAL V2 look (twin blunt horns
// + a small crown spike) kept as the default/frontier-fallback silhouette.
// ---------------------------------------------------------------------------
function drawCrownMap1(g: Graphics, r: number, cy: number, color: number): void {
  g.poly([-r * 0.32, cy - r * 0.85, -r * 0.52, cy - r * 1.55, -r * 0.1, cy - r * 0.95], true).fill(
    color,
  );
  g.poly([r * 0.32, cy - r * 0.85, r * 0.52, cy - r * 1.55, r * 0.1, cy - r * 0.95], true).fill(
    color,
  );
  g.poly([-r * 0.1, cy - r * 0.95, r * 0.1, cy - r * 0.95, 0, cy - r * 1.3], true).fill(color);
}

// ---------------------------------------------------------------------------
// map2 s10 — Demon Sovereign: big curled ram horns sweeping out then curling
// back up, plus spiked pauldrons — reads bulkier/meaner than the cave guardian.
// ---------------------------------------------------------------------------
function drawCrownMap2(g: Graphics, r: number, cy: number, color: number): void {
  const right = crescentPoints(r * 0.18, cy - r * 0.95, r * 0.95, r * 0.5, -55, 70);
  g.poly(right, true).fill(color);
  g.poly(mirrorX(right), true).fill(color);
  // small central spike between the horns, same silhouette language as map1.
  g.poly([-r * 0.08, cy - r * 0.9, r * 0.08, cy - r * 0.9, 0, cy - r * 1.15], true).fill(color);
}
function drawShouldersMap2(g: Graphics, r: number, cy: number, color: number): void {
  const right = [r * 0.75, cy - r * 0.05, r * 1.05, cy - r * 0.35, r * 0.85, cy + r * 0.15];
  g.poly(right, true).fill(color);
  g.poly(mirrorX(right), true).fill(color);
}

// ---------------------------------------------------------------------------
// map3 s15 — Frontier Warlord: jagged mohawk crest + jutting tusks, dusty
// tribal silhouette (angular, no curves) matching the wild-frontier biome.
// ---------------------------------------------------------------------------
function drawCrownMap3(g: Graphics, r: number, cy: number, color: number): void {
  const spikeXs = [-0.42, -0.18, 0, 0.18, 0.42];
  const heights = [0.35, 0.55, 0.75, 0.55, 0.35];
  for (let i = 0; i < spikeXs.length - 1; i++) {
    const x0 = spikeXs[i] * r;
    const x1 = spikeXs[i + 1] * r;
    const xm = (x0 + x1) / 2;
    const h = Math.max(heights[i], heights[i + 1]) * r;
    g.poly([x0, cy - r * 0.8, x1, cy - r * 0.8, xm, cy - r * 0.8 - h], true).fill(color);
  }
  // tusks jutting from the lower jaw.
  const rightTusk = [r * 0.18, cy + r * 0.18, r * 0.32, cy + r * 0.42, r * 0.12, cy + r * 0.3];
  g.poly(rightTusk, true).fill(color);
  g.poly(mirrorX(rightTusk), true).fill(color);
}

// ---------------------------------------------------------------------------
// map4 s20 — Glacial Sovereign: symmetric icicle crown (tall center spike +
// two shorter flanking shards) + angular ice shoulder plates.
// ---------------------------------------------------------------------------
function drawCrownMap4(g: Graphics, r: number, cy: number, color: number): void {
  g.poly([-r * 0.14, cy - r * 0.9, r * 0.14, cy - r * 0.9, 0, cy - r * 1.7], true).fill(color);
  const rightShard = [r * 0.2, cy - r * 0.85, r * 0.42, cy - r * 0.85, r * 0.3, cy - r * 1.35];
  g.poly(rightShard, true).fill(color);
  g.poly(mirrorX(rightShard), true).fill(color);
}
function drawShouldersMap4(g: Graphics, r: number, cy: number, color: number): void {
  const right = [r * 0.7, cy - r * 0.1, r * 0.98, cy + r * 0.05, r * 0.7, cy + r * 0.28];
  g.poly(right, true).fill(color);
  g.poly(mirrorX(right), true).fill(color);
}

// ---------------------------------------------------------------------------
// map5 s25 — Buried Pharaoh: nemes headdress (flat trapezoidal side-flaps +
// a forehead band) topped with a curved uraeus (cobra) crest, sandstone gold.
// ---------------------------------------------------------------------------
function drawCrownMap5(g: Graphics, r: number, cy: number, color: number): void {
  // forehead band.
  g.poly(
    [-r * 0.42, cy - r * 0.78, r * 0.42, cy - r * 0.78, r * 0.36, cy - r * 0.62, -r * 0.36, cy - r * 0.62],
    true,
  ).fill(color);
  // nemes side-flaps hanging past the shoulders.
  const rightFlap = [
    r * 0.42,
    cy - r * 0.7,
    r * 0.62,
    cy - r * 0.1,
    r * 0.42,
    cy + r * 0.15,
    r * 0.28,
    cy - r * 0.5,
  ];
  g.poly(rightFlap, true).fill(color);
  g.poly(mirrorX(rightFlap), true).fill(color);
  // uraeus (raised cobra hood) crest, point-sampled curve, centered above the band.
  const hood = crescentPoints(0, cy - r * 1.05, r * 0.3, r * 0.14, 200, 340);
  g.poly(hood, true).fill(color);
  g.circle(0, cy - r * 1.18, Math.max(0, r * 0.09)).fill(color);
}

// ---------------------------------------------------------------------------
// map6 s30 — Infernal Sovereign: the tallest, most backswept curled horns +
// a taller central flame-crown spike — reads as "biggest/last" boss.
// ---------------------------------------------------------------------------
function drawCrownMap6(g: Graphics, r: number, cy: number, color: number): void {
  const right = crescentPoints(r * 0.16, cy - r, r * 1.15, r * 0.55, -70, 95);
  g.poly(right, true).fill(color);
  g.poly(mirrorX(right), true).fill(color);
  g.poly([-r * 0.1, cy - r * 0.95, r * 0.1, cy - r * 0.95, 0, cy - r * 1.5], true).fill(color);
}
/** Molten crack accents across the body face — infernal sovereign only, a
 * glowing-line variant of the plate-seam strokes `bossView.ts` already draws
 * (same stroke vocabulary, just a hot accent color instead of black alpha). */
function drawCracksMap6(g: Graphics, r: number, cy: number, color: number): void {
  g.moveTo(-r * 0.5, cy - r * 0.1)
    .lineTo(-r * 0.1, cy + r * 0.15)
    .lineTo(r * 0.15, cy - r * 0.05)
    .stroke({ width: 2, color, alpha: 0.65 });
  g.moveTo(r * 0.05, cy + r * 0.2)
    .lineTo(r * 0.4, cy + r * 0.05)
    .stroke({ width: 2, color, alpha: 0.55 });
}

const THEMES: Record<BossMapId, BossTheme> = {
  map1: {
    key: "map1",
    bodyColor: BOSS_COLORS.map1.body,
    crownColor: BOSS_COLORS.map1.crown,
    eyeColor: BOSS_COLORS.map1.eye,
    drawCrown: drawCrownMap1,
  },
  map2: {
    key: "map2",
    bodyColor: BOSS_COLORS.map2.body,
    crownColor: BOSS_COLORS.map2.crown,
    eyeColor: BOSS_COLORS.map2.eye,
    drawCrown: drawCrownMap2,
    drawExtra: drawShouldersMap2,
  },
  map3: {
    key: "map3",
    bodyColor: BOSS_COLORS.map3.body,
    crownColor: BOSS_COLORS.map3.crown,
    eyeColor: BOSS_COLORS.map3.eye,
    drawCrown: drawCrownMap3,
  },
  map4: {
    key: "map4",
    bodyColor: BOSS_COLORS.map4.body,
    crownColor: BOSS_COLORS.map4.crown,
    eyeColor: BOSS_COLORS.map4.eye,
    drawCrown: drawCrownMap4,
    drawExtra: drawShouldersMap4,
  },
  map5: {
    key: "map5",
    bodyColor: BOSS_COLORS.map5.body,
    crownColor: BOSS_COLORS.map5.crown,
    eyeColor: BOSS_COLORS.map5.eye,
    drawCrown: drawCrownMap5,
  },
  map6: {
    key: "map6",
    bodyColor: BOSS_COLORS.map6.body,
    crownColor: BOSS_COLORS.map6.crown,
    eyeColor: BOSS_COLORS.map6.eye,
    drawCrown: drawCrownMap6,
    drawExtra: drawCracksMap6,
  },
};

/** Resolve a boss's visual theme from the map it belongs to. Falls back to
 * the map1 "Cave Guardian" look for any id outside the 6 configured maps
 * (frontier-overflow content beyond `CONFIG.world.maps`, mirroring
 * `biomes.ts`'s own `biomeForStage` fallback convention) — the boss rig
 * always has SOME identity, never an undefined-color crash. */
export function bossThemeForMap(mapId: string | undefined): BossTheme {
  return (mapId && THEMES[mapId as BossMapId]) || THEMES.map1;
}
