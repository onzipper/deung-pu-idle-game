/**
 * Per-map mob-species silhouette identity (M7.9 "new mob species", owner-
 * approved, render-only). Mirrors `bossThemes.ts`'s data + point-sampled
 * shape-builder approach, but keyed by `mapId × EnemyKind` instead of just
 * `mapId` (bosses are one-per-map singletons; regular enemies come in the
 * same 4 kinds on every map).
 *
 * `enemyView.ts` is the only caller — it draws these onto the SAME build-once
 * `body` Graphics it always has (kind is immutable for an entity's lifetime,
 * and per the M7.9 brief enemies never change map mid-life either, so a
 * species choice baked in at first-sight `buildRig()` time is safe — no
 * per-frame re-resolution needed). Nothing else about the rig changes: same 4
 * parts (`body`/`legs`/`limbArm`/`hpBar`), same pivots/ground-contact
 * conventions, same `ENEMY_MOTION` per-kind movement personality — only WHICH
 * shapes/color this kind's `body` draws varies by map.
 *
 * map1/2/3 (+ any frontier-overflow map id outside the configured roster) all
 * resolve to the exact SAME builder functions + `ENEMY_COLORS` (the ORIGINAL,
 * unmodified per-kind silhouettes) — literally the same function reference,
 * not just equivalent code, so those 3 maps are provably byte-identical to
 * before this task (see `__tests__/enemySpecies.test.ts`).
 *
 * Footguns respected throughout: absolute GROUND_Y-relative coordinates (no
 * pivot pre-subtraction — footgun 1), every curved cap point-sampled via
 * `poly()` rather than `Graphics.arc().fill()` (footgun 2 — in practice this
 * file only needs straight-edged polys + full `circle()` fills, which are NOT
 * the arc-fill footgun), every radius through `safeRadius()`, no hand-built
 * gradients (flat alpha layers only).
 */

import type { Graphics } from "pixi.js";
import type { EnemyKind } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import {
  ENEMY_COLORS,
  ENEMY_SPECIES_ACCENT,
  ENEMY_SPECIES_COLORS,
  ENEMY_SPECIES_WRAITH_ACCENT,
  PALETTE,
  safeRadius,
  type BossMapId,
} from "@/render/theme";

type EnemyMapId = BossMapId | "asura";

/** Draws a kind's full body silhouette (fills + shading/eyes/plates) onto
 * `g`, in absolute GROUND_Y-relative coordinates. `s` is the already-clamped
 * `Math.max(0.1, enemy.size)` scale; `color` is this species' resolved body
 * hue for the kind. */
type BodyBuilder = (g: Graphics, s: number, color: number) => void;

// ---------------------------------------------------------------------------
// map1/2/3 fallback — the ORIGINAL PROCEDURAL V2 silhouettes (task 86d3k2nj3),
// extracted verbatim (no numeric/param changes) from what was `enemyView.ts`'s
// `buildRig()` body switch. Kept as the frontier-overflow fallback too,
// mirroring `bossThemes.ts::bossThemeForMap`'s own fallback convention.
// ---------------------------------------------------------------------------

function buildBaseTank(g: Graphics, s: number, color: number): void {
  const bx = -12 * s;
  const by = GROUND_Y - 30 * s;
  const bw = safeRadius(24 * s);
  const bh = safeRadius(28 * s);
  g.roundRect(bx, by, bw, bh, 4).fill(color);
  g.rect(bx, by + bh * 0.32, bw, Math.max(1, 1.2 * s)).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(bx, by + bh * 0.62, bw, Math.max(1, 1.2 * s)).fill({ color: 0x000000, alpha: 0.2 });
  g.roundRect(bx + 1.5 * s, GROUND_Y - 9 * s, 7 * s, 5 * s, 1).fill({
    color: 0x000000,
    alpha: 0.45,
  });
  g.circle(-6 * s, GROUND_Y - 26 * s, safeRadius(1.7 * s)).fill({
    color: 0x000000,
    alpha: 0.65,
  });
  g.circle(-9.5 * s, GROUND_Y - 26 * s, safeRadius(1.7 * s)).fill({
    color: 0x000000,
    alpha: 0.65,
  });
}

function buildBaseRanged(g: Graphics, s: number, color: number): void {
  const cy = GROUND_Y - 16;
  g.poly([0, cy - 10 * s, 10 * s, cy, 0, cy + 10 * s, -10 * s, cy], true).fill(color);
  g.poly([0, cy - 10 * s, 6 * s, cy - 2 * s, 0, cy + 2 * s, -6 * s, cy - 2 * s], true).fill({
    color: 0x000000,
    alpha: 0.28,
  });
  g.circle(-2.2 * s, cy - 2.5 * s, safeRadius(1.1 * s)).fill({ color: 0xffffff, alpha: 0.85 });
}

function buildBaseFast(g: Graphics, s: number, color: number): void {
  g.poly(
    [-17 * s, GROUND_Y - 10, 9 * s, GROUND_Y - 20, 15 * s, GROUND_Y - 8, 7 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.moveTo(-11 * s, GROUND_Y - 15)
    .lineTo(-4 * s, GROUND_Y - 18)
    .stroke({ width: 1.4, color: PALETTE.outline, alpha: 0.7, cap: "round" });
  g.moveTo(-11 * s, GROUND_Y - 12)
    .lineTo(-4 * s, GROUND_Y - 14.5)
    .stroke({ width: 1.4, color: PALETTE.outline, alpha: 0.7, cap: "round" });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(2.5 * s)).fill({ color: 0x000000, alpha: 0.5 });
  g.circle(-8 * s, GROUND_Y - 17, safeRadius(2 * s)).fill({ color: 0x000000, alpha: 0.5 });
}

function buildBaseNormal(g: Graphics, s: number, color: number): void {
  g.poly(
    [-15 * s, GROUND_Y - 16, 13 * s, GROUND_Y - 16 - 14 * s, 13 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.moveTo(-11 * s, GROUND_Y - 22)
    .lineTo(-3 * s, GROUND_Y - 24)
    .stroke({ width: 1.2, color: 0x000000, alpha: 0.3, cap: "round" });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(2.5 * s)).fill({ color: 0x000000, alpha: 0.5 });
  g.circle(-8 * s, GROUND_Y - 17, safeRadius(2 * s)).fill({ color: 0x000000, alpha: 0.5 });
}

const BASE_BUILDERS: Record<EnemyKind, BodyBuilder> = {
  tank: buildBaseTank,
  ranged: buildBaseRanged,
  fast: buildBaseFast,
  normal: buildBaseNormal,
};

// ---------------------------------------------------------------------------
// map4 s16-20 — Ice Tundra: frost-wolf (fast) / ice golem (tank) / frozen
// shambler (normal) / frost-wisp caster (ranged). Pale blues, crystalline
// edges, glowing cold eyes (`ENEMY_SPECIES_ACCENT.map4`).
// ---------------------------------------------------------------------------
const ICE_GLOW = ENEMY_SPECIES_ACCENT.map4;

function buildIceFrostWolf(g: Graphics, s: number, color: number): void {
  g.poly(
    [-16 * s, GROUND_Y - 9, -6 * s, GROUND_Y - 19, 10 * s, GROUND_Y - 16, 15 * s, GROUND_Y - 7, 6 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  // crystalline back-ridge highlight.
  g.moveTo(-6 * s, GROUND_Y - 19)
    .lineTo(10 * s, GROUND_Y - 16)
    .stroke({ width: 1.4, color: 0xffffff, alpha: 0.35, cap: "round" });
  g.moveTo(-16 * s, GROUND_Y - 9)
    .lineTo(-6 * s, GROUND_Y - 19)
    .stroke({ width: 1, color: PALETTE.outline, alpha: 0.5, cap: "round" });
  g.circle(9 * s, GROUND_Y - 13, safeRadius(1.3 * s)).fill({ color: ICE_GLOW, alpha: 0.9 });
}

function buildIceGolem(g: Graphics, s: number, color: number): void {
  const bx = -13 * s;
  const by = GROUND_Y - 32 * s;
  const bw = safeRadius(26 * s);
  const bh = safeRadius(30 * s);
  g.roundRect(bx, by, bw, bh, 3).fill(color);
  g.moveTo(bx, by + bh * 0.25)
    .lineTo(bx + bw, by + bh * 0.4)
    .stroke({ width: 1.2, color: 0xffffff, alpha: 0.25 });
  g.moveTo(bx, by + bh * 0.6)
    .lineTo(bx + bw, by + bh * 0.72)
    .stroke({ width: 1.2, color: 0xffffff, alpha: 0.2 });
  g.poly([bx - 2 * s, by + bh * 0.15, bx - 8 * s, by + bh * 0.05, bx - 2 * s, by + bh * 0.35], true).fill(
    color,
  );
  g.poly(
    [bx + bw + 2 * s, by + bh * 0.15, bx + bw + 8 * s, by + bh * 0.05, bx + bw + 2 * s, by + bh * 0.35],
    true,
  ).fill(color);
  g.circle(bx + bw * 0.3, by + bh * 0.3, safeRadius(1.8 * s)).fill({ color: ICE_GLOW, alpha: 0.85 });
  g.circle(bx + bw * 0.62, by + bh * 0.3, safeRadius(1.8 * s)).fill({ color: ICE_GLOW, alpha: 0.85 });
}

function buildIceFrozenShambler(g: Graphics, s: number, color: number): void {
  g.poly(
    [-15 * s, GROUND_Y - 16, 13 * s, GROUND_Y - 16 - 14 * s, 13 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.poly(
    [-10 * s, GROUND_Y - 16 - 6 * s, 2 * s, GROUND_Y - 16 - 11 * s, 8 * s, GROUND_Y - 16 - 4 * s],
    true,
  ).fill({ color: 0xffffff, alpha: 0.18 });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(2.3 * s)).fill({ color: 0x000000, alpha: 0.55 });
  g.circle(-8 * s, GROUND_Y - 17, safeRadius(1.9 * s)).fill({ color: 0x000000, alpha: 0.55 });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(0.8 * s)).fill({ color: ICE_GLOW, alpha: 0.6 });
}

function buildIceFrostWisp(g: Graphics, s: number, color: number): void {
  const cy = GROUND_Y - 16;
  g.poly([0, cy - 11 * s, 9 * s, cy - 1 * s, 0, cy + 9 * s, -9 * s, cy - 1 * s], true).fill(color);
  g.poly([-4 * s, cy + 7 * s, 0, cy + 13 * s, 4 * s, cy + 7 * s], true).fill({ color, alpha: 0.5 });
  g.poly([0, cy - 11 * s, 5 * s, cy - 3 * s, 0, cy + 1 * s, -5 * s, cy - 3 * s], true).fill({
    color: 0x000000,
    alpha: 0.22,
  });
  g.circle(-2 * s, cy - 3 * s, safeRadius(1.2 * s)).fill({ color: ICE_GLOW, alpha: 0.95 });
}

const MAP4_BUILDERS: Record<EnemyKind, BodyBuilder> = {
  fast: buildIceFrostWolf,
  tank: buildIceGolem,
  normal: buildIceFrozenShambler,
  ranged: buildIceFrostWisp,
};

// ---------------------------------------------------------------------------
// map5 s21-25 — Desert Ruins: sand scorpion (fast) / sandstone colossus
// fragment (tank) / bandaged mummy (normal) / sand-wraith staff caster
// (ranged). Sandstone/gold, tattered wrappings.
// ---------------------------------------------------------------------------
const SAND_GLOW = ENEMY_SPECIES_ACCENT.map5;

function buildSandScorpion(g: Graphics, s: number, color: number): void {
  g.poly(
    [-16 * s, GROUND_Y - 8, -4 * s, GROUND_Y - 16, 8 * s, GROUND_Y - 14, 14 * s, GROUND_Y - 6, 6 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  // curled tail segments arcing up over the back.
  g.poly([-14 * s, GROUND_Y - 10, -18 * s, GROUND_Y - 18, -12 * s, GROUND_Y - 16], true).fill(color);
  g.poly([-17 * s, GROUND_Y - 17, -19 * s, GROUND_Y - 24, -14 * s, GROUND_Y - 20], true).fill(color);
  g.circle(12 * s, GROUND_Y - 8, safeRadius(1.3 * s)).fill({ color: SAND_GLOW, alpha: 0.8 });
}

function buildSandColossus(g: Graphics, s: number, color: number): void {
  const bx = -12 * s;
  const by = GROUND_Y - 30 * s;
  const bw = safeRadius(24 * s);
  const bh = safeRadius(28 * s);
  g.roundRect(bx, by, bw, bh, 2).fill(color);
  g.moveTo(bx, by + bh * 0.3)
    .lineTo(bx + bw, by + bh * 0.22)
    .stroke({ width: 1.4, color: 0x000000, alpha: 0.3 });
  g.moveTo(bx, by + bh * 0.65)
    .lineTo(bx + bw, by + bh * 0.58)
    .stroke({ width: 1.4, color: 0x000000, alpha: 0.25 });
  g.poly([bx + bw - 4 * s, by, bx + bw, by, bx + bw, by + 5 * s], true).fill({
    color: 0x000000,
    alpha: 0.3,
  });
  g.circle(bx + bw * 0.32, by + bh * 0.28, safeRadius(1.7 * s)).fill({ color: SAND_GLOW, alpha: 0.85 });
  g.circle(bx + bw * 0.62, by + bh * 0.28, safeRadius(1.7 * s)).fill({ color: SAND_GLOW, alpha: 0.85 });
}

function buildSandMummy(g: Graphics, s: number, color: number): void {
  g.poly(
    [-14 * s, GROUND_Y - 16, 12 * s, GROUND_Y - 16 - 13 * s, 12 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.moveTo(-12 * s, GROUND_Y - 8)
    .lineTo(10 * s, GROUND_Y - 10)
    .stroke({ width: 1.2, color: 0x000000, alpha: 0.25 });
  g.moveTo(-13 * s, GROUND_Y - 15)
    .lineTo(9 * s, GROUND_Y - 19)
    .stroke({ width: 1.2, color: 0x000000, alpha: 0.22 });
  g.moveTo(-11 * s, GROUND_Y - 22)
    .lineTo(7 * s, GROUND_Y - 24)
    .stroke({ width: 1.2, color: 0x000000, alpha: 0.2 });
  g.circle(-2 * s, GROUND_Y - 18, safeRadius(1.6 * s)).fill({ color: SAND_GLOW, alpha: 0.75 });
  g.circle(-7 * s, GROUND_Y - 18, safeRadius(1.4 * s)).fill({ color: SAND_GLOW, alpha: 0.75 });
}

function buildSandWraith(g: Graphics, s: number, color: number): void {
  const cy = GROUND_Y - 16;
  g.poly([0, cy - 10 * s, 8 * s, cy, 0, cy + 10 * s, -8 * s, cy], true).fill(color);
  g.poly([-5 * s, cy + 8 * s, -8 * s, cy + 14 * s, -2 * s, cy + 9 * s], true).fill(color);
  g.poly([3 * s, cy + 9 * s, 6 * s, cy + 15 * s, 1 * s, cy + 9 * s], true).fill(color);
  g.poly([0, cy - 10 * s, 5 * s, cy - 2 * s, 0, cy + 2 * s, -5 * s, cy - 2 * s], true).fill({
    color: 0x000000,
    alpha: 0.3,
  });
  g.circle(-2 * s, cy - 2.5 * s, safeRadius(1.1 * s)).fill({
    color: ENEMY_SPECIES_WRAITH_ACCENT,
    alpha: 0.9,
  });
}

const MAP5_BUILDERS: Record<EnemyKind, BodyBuilder> = {
  fast: buildSandScorpion,
  tank: buildSandColossus,
  normal: buildSandMummy,
  ranged: buildSandWraith,
};

// ---------------------------------------------------------------------------
// map6 s26-30 — Hell City: imp (fast) / charcoal brute w/ ember cracks (tank)
// / ash ghoul (normal) / cinder warlock (ranged). Near-black bodies, ember
// crack-lines, red eyes — bodies kept deliberately lighter-value than the
// near-black hell-city grounds (`environment/biomes.ts` MAP6) plus a thin
// `PALETTE.outline` edge on the smallest kind, so the silhouette pops even
// before the ember glow accent (`ENEMY_SPECIES_ACCENT.map6`) reads.
// ---------------------------------------------------------------------------
const EMBER_GLOW = ENEMY_SPECIES_ACCENT.map6;

function buildHellImp(g: Graphics, s: number, color: number): void {
  g.poly(
    [-14 * s, GROUND_Y - 8, -2 * s, GROUND_Y - 18, 10 * s, GROUND_Y - 15, 13 * s, GROUND_Y - 6, 5 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.poly([-8 * s, GROUND_Y - 16, -11 * s, GROUND_Y - 22, -6 * s, GROUND_Y - 17], true).fill(color);
  g.poly([-2 * s, GROUND_Y - 18, -3 * s, GROUND_Y - 24, 1 * s, GROUND_Y - 19], true).fill(color);
  g.moveTo(-14 * s, GROUND_Y - 8)
    .lineTo(-2 * s, GROUND_Y - 18)
    .lineTo(10 * s, GROUND_Y - 15)
    .stroke({ width: 1, color: PALETTE.outline, alpha: 0.6 });
  g.circle(8 * s, GROUND_Y - 12, safeRadius(1.3 * s)).fill({ color: EMBER_GLOW, alpha: 0.95 });
}

function buildHellCharcoalBrute(g: Graphics, s: number, color: number): void {
  const bx = -13 * s;
  const by = GROUND_Y - 31 * s;
  const bw = safeRadius(25 * s);
  const bh = safeRadius(29 * s);
  g.roundRect(bx, by, bw, bh, 4).fill(color);
  g.moveTo(bx + bw * 0.2, by + bh * 0.15)
    .lineTo(bx + bw * 0.5, by + bh * 0.4)
    .lineTo(bx + bw * 0.3, by + bh * 0.7)
    .stroke({ width: 1.6, color: EMBER_GLOW, alpha: 0.75 });
  g.moveTo(bx + bw * 0.6, by + bh * 0.3)
    .lineTo(bx + bw * 0.8, by + bh * 0.55)
    .stroke({ width: 1.6, color: EMBER_GLOW, alpha: 0.6 });
  g.roundRect(bx + 1.5 * s, GROUND_Y - 9 * s, 7 * s, 5 * s, 1).fill({ color: 0x000000, alpha: 0.4 });
  g.circle(bx + bw * 0.3, by + bh * 0.22, safeRadius(1.6 * s)).fill({ color: EMBER_GLOW, alpha: 0.9 });
  g.circle(bx + bw * 0.55, by + bh * 0.22, safeRadius(1.6 * s)).fill({ color: EMBER_GLOW, alpha: 0.9 });
}

function buildHellAshGhoul(g: Graphics, s: number, color: number): void {
  g.poly(
    [-15 * s, GROUND_Y - 16, 13 * s, GROUND_Y - 16 - 14 * s, 13 * s, GROUND_Y - 2],
    true,
  ).fill(color);
  g.moveTo(-11 * s, GROUND_Y - 10)
    .lineTo(9 * s, GROUND_Y - 12)
    .stroke({ width: 1.2, color: 0x000000, alpha: 0.3 });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(2.2 * s)).fill({ color: 0x000000, alpha: 0.5 });
  g.circle(-8 * s, GROUND_Y - 17, safeRadius(1.8 * s)).fill({ color: 0x000000, alpha: 0.5 });
  g.circle(-3 * s, GROUND_Y - 17, safeRadius(0.9 * s)).fill({ color: EMBER_GLOW, alpha: 0.8 });
  g.circle(-8 * s, GROUND_Y - 17, safeRadius(0.7 * s)).fill({ color: EMBER_GLOW, alpha: 0.8 });
}

function buildHellCinderWarlock(g: Graphics, s: number, color: number): void {
  const cy = GROUND_Y - 16;
  g.poly([0, cy - 10 * s, 9 * s, cy - 1 * s, 0, cy + 10 * s, -9 * s, cy - 1 * s], true).fill(color);
  g.poly([0, cy - 10 * s, 5 * s, cy - 2 * s, 0, cy + 2 * s, -5 * s, cy - 2 * s], true).fill({
    color: 0x000000,
    alpha: 0.3,
  });
  g.circle(-2 * s, cy - 2.5 * s, safeRadius(1.2 * s)).fill({ color: EMBER_GLOW, alpha: 0.95 });
  g.circle(6 * s, cy + 2 * s, safeRadius(1 * s)).fill({ color: EMBER_GLOW, alpha: 0.5 });
}

const MAP6_BUILDERS: Record<EnemyKind, BodyBuilder> = {
  fast: buildHellImp,
  tank: buildHellCharcoalBrute,
  normal: buildHellAshGhoul,
  ranged: buildHellCinderWarlock,
};

// ---------------------------------------------------------------------------
// Resolution table + public API.
// ---------------------------------------------------------------------------
interface MapEnemyTheme {
  colors: Record<EnemyKind, number>;
  builders: Record<EnemyKind, BodyBuilder>;
}

const SPECIES: Record<EnemyMapId, MapEnemyTheme> = {
  map1: { colors: ENEMY_COLORS, builders: BASE_BUILDERS },
  map2: { colors: ENEMY_COLORS, builders: BASE_BUILDERS },
  map3: { colors: ENEMY_COLORS, builders: BASE_BUILDERS },
  map4: { colors: ENEMY_SPECIES_COLORS.map4, builders: MAP4_BUILDERS },
  map5: { colors: ENEMY_SPECIES_COLORS.map5, builders: MAP5_BUILDERS },
  map6: { colors: ENEMY_SPECIES_COLORS.map6, builders: MAP6_BUILDERS },
  // ดินแดนอสูร (ASURA endgame v1, docs/endgame-design.md) — deliberately reuses
  // MAP6_BUILDERS verbatim (the exact same imp/charcoal-brute/ash-ghoul/cinder-
  // warlock silhouettes the player already fought in map6) with `asura`'s own
  // corrupted violet-black colors (`ENEMY_SPECIES_COLORS.asura`) — "the same
  // demons, corrupted further" rather than a brand-new, costlier shape set.
  // s1-30 (map1-6) are untouched — this only adds a NEW key.
  asura: { colors: ENEMY_SPECIES_COLORS.asura, builders: MAP6_BUILDERS },
};

/** Resolve a kind's body color + shape-builder for the given map. Falls back
 * to the map1 (== map2 == map3, same table entry) look for any id outside
 * the 6 configured maps — same frontier-overflow convention as
 * `bossThemes.ts::bossThemeForMap`, and the SAME reasoning: this render layer
 * always has SOME identity to draw, never an undefined-color crash. */
export function enemySpeciesFor(
  mapId: string | undefined,
  kind: EnemyKind,
): { color: number; build: BodyBuilder } {
  const theme = (mapId && SPECIES[mapId as EnemyMapId]) || SPECIES.map1;
  return { color: theme.colors[kind], build: theme.builders[kind] };
}

/** Just the color half of `enemySpeciesFor` — the channel every OTHER
 * ENEMY_COLORS consumer (`fx/corpseEcho.ts`'s death-collapse tint,
 * `FxController.ts`'s kill-dissolve burst + spawn-portal tint) reads through,
 * so a map4/5/6 mob's death/spawn fx stay tinted to ITS OWN species instead of
 * silently falling back to the map-agnostic base palette. */
export function enemyColorFor(mapId: string | undefined, kind: EnemyKind): number {
  return enemySpeciesFor(mapId, kind).color;
}
