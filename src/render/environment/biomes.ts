/**
 * Biome data — the single source of truth for the background system's visual
 * identity per zone. Pure data (no Pixi objects here); `environment/*` reads
 * these to build layers. See `render/README.md` "Art direction" section for
 * the full rationale.
 *
 * M6 "World & Town" reshapes this from "one biome loop keyed by raw stage
 * number" to MAP-THEMED FAMILIES keyed by the zone the player is actually
 * standing in (`biomeForZone`, fed `zoneAt(state.location)` — see
 * `engine/systems/world.ts`): each map (`CONFIG.world.maps`) gets its own
 * coherent theme escalating toward its boss room, plus a dedicated TOWN biome
 * (map1 only) and a dedicated, deliberately more intense BOSS biome per map
 * (not just "the last farm zone again" — see `render/README.md`'s boss-room
 * note). `stage` alone can't distinguish "farm zone N" from "the boss room"
 * (they can share a stage number, e.g. map1's last farm zone and its boss
 * room are both stage 5) or "town" from "farm zone 1" (both stage 1) — this
 * is exactly why zone KIND, not stage, drives the lookup.
 *
 * The original 5-biome hue-looping system (`BIOMES`/`biomeForStage`) is KEPT
 * as the frontier-overflow fallback for any stage beyond the configured maps
 * (`CONFIG.world`'s own doc comment calls map3 a "soft-wall frontier... this
 * ceiling is intended, extended by M7/M8 content") — campaigns never run out
 * of scenery even before a 4th map is authored.
 *
 * Shape language escalates with each map's own order (rolling -> jagged/
 * twisted -> sharp/glowing) to echo rising danger toward that map's boss;
 * hero/enemy animation should echo the same escalation instead of introducing
 * a new one (see README).
 */

import { CONFIG } from "@/engine/config";
import type { Zone } from "@/engine";
import { adjustLightness, shiftHue } from "@/render/environment/colorUtils";

export type SilhouetteShape =
  | "rolling-hills"
  | "treeline"
  | "jagged-rock"
  | "volcanic-ridge"
  | "frost-peaks"
  | "rooftops";

export type AmbientKind = "mote" | "leaf" | "dust" | "ember" | "snow" | "smoke";

/** Which shared prop vocabulary `groundProps.ts` draws for this biome's near
 * layer — decoupled from `id` so many map-specific biome ids can reuse the
 * same handful of hand-built prop shapes instead of a per-id switch. */
export type PropStyle = "grass" | "bush" | "rock" | "crystal" | "ember" | "town";

export interface BiomeDef {
  /** Stable id (also used as the base React/Pixi key before variant suffixing). */
  id: string;
  /** Thai display name (unused in-canvas today, kept for a future biome toast). */
  nameTh: string;
  /** Marks a biome as needing the dedicated town dressing (lanterns/rooftops/
   * NPC silhouettes, see `groundProps.ts`/`silhouettes.ts`) or the boss-room
   * arena framing + vignette (`bossArena.ts`) — read by `BiomeScene.ts`. */
  special?: "town" | "bossRoom";
  sky: {
    top: number;
    bottom: number;
    /** Faint accent band hugging the horizon (dusk/glow color). */
    horizon: number;
  };
  far: {
    color: number;
    alpha: number;
    shape: SilhouetteShape;
    /** Peak-to-trough height in world px. */
    amplitude: number;
    /** Roughly how many features per 100px of chunk width. */
    density: number;
    /** Optional thin glowing rim stroked along the silhouette's top edge. */
    glowRim?: number;
  };
  ground: {
    /** Main band fill. */
    base: number;
    /** Thin lighter strip along the top edge (depth cue). */
    band: number;
    /** Speckle/texture dot color baked into the static band. */
    speckle: number;
    /** Scrolling foreground prop color (rocks/tufts/crystals/embers/lanterns). */
    accent: number;
    /** Which near-layer prop shapes `groundProps.ts` draws. */
    propStyle: PropStyle;
  };
  particle: {
    kind: AmbientKind;
    color: number;
    /** Concurrent ambient particle count — kept low by design. */
    density: number;
  };
  /** Optional low-alpha full-band tint (fog/haze) — a flat rect, not a filter. */
  weatherTint?: { color: number; alpha: number };
  /** Base scroll speed in world px/real-second at 1x (battle-phase) pace. */
  scrollSpeed: { far: number; near: number };
}

// ---------------------------------------------------------------------------
// Frontier-overflow fallback loop (pre-M6 system, kept verbatim as the safety
// net for any stage beyond the configured maps — see module doc comment).
// ---------------------------------------------------------------------------

const MEADOW: BiomeDef = {
  id: "meadow",
  nameTh: "ทุ่งหญ้ายามเย็น",
  sky: { top: 0x1a2c4a, bottom: 0x2c3f5e, horizon: 0xe8a75d },
  far: { color: 0x24344a, alpha: 0.55, shape: "rolling-hills", amplitude: 26, density: 0.6 },
  ground: { base: 0x263a2e, band: 0x30492f, speckle: 0x3f5a3a, accent: 0x6fae4a, propStyle: "grass" },
  particle: { kind: "mote", color: 0xf2d98a, density: 10 },
  scrollSpeed: { far: 6, near: 18 },
};

const FOREST: BiomeDef = {
  id: "forest",
  nameTh: "ป่าทึบ",
  sky: { top: 0x111d24, bottom: 0x1c2f34, horizon: 0x6fa384 },
  far: { color: 0x152420, alpha: 0.65, shape: "treeline", amplitude: 46, density: 1.1 },
  ground: { base: 0x1e2a1e, band: 0x263323, speckle: 0x35452c, accent: 0xb4703a, propStyle: "bush" },
  particle: { kind: "leaf", color: 0xc98a3f, density: 9 },
  weatherTint: { color: 0x1f3a2c, alpha: 0.08 },
  scrollSpeed: { far: 8, near: 22 },
};

const CAVE: BiomeDef = {
  id: "cave",
  nameTh: "ถ้ำหินผา",
  sky: { top: 0x14131c, bottom: 0x211f30, horizon: 0x5a5478 },
  far: { color: 0x1c1a28, alpha: 0.7, shape: "jagged-rock", amplitude: 58, density: 1.3 },
  ground: { base: 0x211f28, band: 0x2b2836, speckle: 0x413c58, accent: 0x8f8ad0, propStyle: "crystal" },
  particle: { kind: "dust", color: 0x9a94c2, density: 8 },
  weatherTint: { color: 0x2a2740, alpha: 0.1 },
  scrollSpeed: { far: 7, near: 20 },
};

const VOLCANIC: BiomeDef = {
  id: "volcanic",
  nameTh: "ภูเขาไฟ",
  sky: { top: 0x1a0f0f, bottom: 0x2e1414, horizon: 0xd9531e },
  far: {
    color: 0x241213,
    alpha: 0.75,
    shape: "volcanic-ridge",
    amplitude: 60,
    density: 1.2,
    glowRim: 0xff7a33,
  },
  ground: { base: 0x231414, band: 0x321a17, speckle: 0x522119, accent: 0xff8a3d, propStyle: "ember" },
  particle: { kind: "ember", color: 0xff8f3d, density: 12 },
  weatherTint: { color: 0x3a1410, alpha: 0.12 },
  scrollSpeed: { far: 9, near: 24 },
};

const FROST: BiomeDef = {
  id: "frost",
  nameTh: "เทือกเขาน้ำแข็ง",
  sky: { top: 0x131c2c, bottom: 0x24344a, horizon: 0xbfe0f5 },
  far: {
    color: 0x28374e,
    alpha: 0.7,
    shape: "frost-peaks",
    amplitude: 64,
    density: 1.0,
    glowRim: 0xdff3ff,
  },
  ground: { base: 0x28323e, band: 0x384656, speckle: 0x54697c, accent: 0xdff3ff, propStyle: "crystal" },
  particle: { kind: "snow", color: 0xf2fbff, density: 11 },
  weatherTint: { color: 0x2c4258, alpha: 0.1 },
  scrollSpeed: { far: 6, near: 18 },
};

/** Ordered biome loop: meadow -> forest -> cave/mountain -> volcanic -> frost,
 * then repeats with a hue-shifted variant (see `biomeForStage`). */
export const BIOMES: readonly BiomeDef[] = [MEADOW, FOREST, CAVE, VOLCANIC, FROST];

/** Hue rotation applied per full loop through `BIOMES`, so a repeat reads as
 * a distinct twilight/dawn variant instead of an identical repeat, without
 * hand-authoring more raw palettes. */
const HUE_STEP_PER_LOOP = 21;

function shiftBiome(biome: BiomeDef, degrees: number): BiomeDef {
  if (degrees === 0) return biome;
  return {
    ...biome,
    sky: {
      top: shiftHue(biome.sky.top, degrees),
      bottom: shiftHue(biome.sky.bottom, degrees),
      horizon: shiftHue(biome.sky.horizon, degrees),
    },
    far: { ...biome.far, color: shiftHue(biome.far.color, degrees) },
    ground: {
      ...biome.ground,
      base: shiftHue(biome.ground.base, degrees),
      band: shiftHue(biome.ground.band, degrees),
      speckle: shiftHue(biome.ground.speckle, degrees),
      accent: shiftHue(biome.ground.accent, degrees),
    },
    particle: { ...biome.particle, color: shiftHue(biome.particle.color, degrees) },
    weatherTint: biome.weatherTint
      ? { ...biome.weatherTint, color: shiftHue(biome.weatherTint.color, degrees) }
      : undefined,
  };
}

/** A biome variant resolved for a specific zone — `key` is stable per
 * (biome, loop) pair, so `Environment` can detect "did the biome actually
 * change" without re-deriving the loop math itself. */
export interface ResolvedBiome extends BiomeDef {
  key: string;
}

/**
 * Frontier-overflow fallback: map a 1-based stage number to a biome, cycling
 * through the 5 base biomes forever (hue-shifted each full loop). Used only
 * when a zone's map isn't one of `MAP_THEMES` (content beyond the configured
 * maps — see module doc comment).
 */
export function biomeForStage(stage: number): ResolvedBiome {
  const s = Math.max(1, Math.floor(stage));
  const idx = (s - 1) % BIOMES.length;
  const loop = Math.floor((s - 1) / BIOMES.length);
  const base = BIOMES[idx];
  const hue = (loop * HUE_STEP_PER_LOOP) % 360;
  const resolved = shiftBiome(base, hue);
  return { ...resolved, key: `${base.id}-${loop}` };
}

// ---------------------------------------------------------------------------
// M6 "World & Town" — map-themed families. Each map is FARM[0..4] escalating
// toward BOSS (deliberately its own, darker/more-intense biome, not a repeat
// of farm[4]) so "getting close to the boss room" keeps reading as more
// dangerous right up to the moment it becomes a whole different, special
// place (the owner-praised "เข้าใกล้ zone บอสยิ่งรู้สึก" feel). Palettes stay
// desaturated/mid-low-value per the binding art direction; only combat
// entities (HERO_COLORS/ENEMY_COLORS/fx accents) get to be saturated jewel
// tones.
// ---------------------------------------------------------------------------

// ---- map1: โลกมนุษย์ (human world) — ทุ่งหญ้า -> ชายป่า -> ป่าลึก -> เชิงเขา ->
// หน้าปากถ้ำ -> (boss) ถ้ำมืด. Warm dusk cooling into cold cave dark. ----

const MAP1_TOWN: BiomeDef = {
  id: "map1-town",
  nameTh: "หมู่บ้านเริ่มต้น",
  special: "town",
  sky: { top: 0x1c2436, bottom: 0x30405a, horizon: 0xffc27a },
  far: { color: 0x30405a, alpha: 0.5, shape: "rooftops", amplitude: 22, density: 0.7 },
  ground: { base: 0x2e2a22, band: 0x3c362a, speckle: 0x4a4234, accent: 0xd9a25a, propStyle: "town" },
  particle: { kind: "smoke", color: 0xe8d9b8, density: 6 },
  scrollSpeed: { far: 4, near: 10 },
};

const MAP1_FARM: readonly BiomeDef[] = [
  {
    id: "map1-zone1",
    nameTh: "ทุ่งหญ้า",
    sky: { top: 0x1a2c4a, bottom: 0x2c3f5e, horizon: 0xe8a75d },
    far: { color: 0x24344a, alpha: 0.55, shape: "rolling-hills", amplitude: 26, density: 0.6 },
    ground: { base: 0x263a2e, band: 0x30492f, speckle: 0x3f5a3a, accent: 0x6fae4a, propStyle: "grass" },
    particle: { kind: "mote", color: 0xf2d98a, density: 10 },
    scrollSpeed: { far: 6, near: 18 },
  },
  {
    id: "map1-zone2",
    nameTh: "ชายป่า",
    sky: { top: 0x172431, bottom: 0x223247, horizon: 0xd89a5a },
    far: { color: 0x1c2a24, alpha: 0.6, shape: "treeline", amplitude: 34, density: 0.8 },
    ground: { base: 0x223523, band: 0x2c3d27, speckle: 0x3a4d2e, accent: 0x8ba24a, propStyle: "bush" },
    particle: { kind: "leaf", color: 0xd0a052, density: 9 },
    scrollSpeed: { far: 7, near: 19 },
  },
  {
    id: "map1-zone3",
    nameTh: "ป่าลึก",
    sky: { top: 0x111d24, bottom: 0x1c2f34, horizon: 0x6fa384 },
    far: { color: 0x152420, alpha: 0.65, shape: "treeline", amplitude: 46, density: 1.1 },
    ground: { base: 0x1e2a1e, band: 0x263323, speckle: 0x35452c, accent: 0xb4703a, propStyle: "bush" },
    particle: { kind: "leaf", color: 0xc98a3f, density: 9 },
    weatherTint: { color: 0x1f3a2c, alpha: 0.08 },
    scrollSpeed: { far: 8, near: 22 },
  },
  {
    id: "map1-zone4",
    nameTh: "เชิงเขา",
    sky: { top: 0x171a22, bottom: 0x232733, horizon: 0x8a7a5a },
    far: { color: 0x1e2027, alpha: 0.68, shape: "jagged-rock", amplitude: 52, density: 1.0 },
    ground: { base: 0x262420, band: 0x342f27, speckle: 0x473f30, accent: 0x9c8a63, propStyle: "rock" },
    particle: { kind: "dust", color: 0xb8a988, density: 9 },
    weatherTint: { color: 0x2a2a30, alpha: 0.09 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map1-zone5",
    nameTh: "หน้าปากถ้ำ",
    sky: { top: 0x121019, bottom: 0x1c1826, horizon: 0x6a5a78 },
    far: {
      color: 0x1a1622,
      alpha: 0.74,
      shape: "jagged-rock",
      amplitude: 58,
      density: 1.2,
      glowRim: 0x8f7ad0,
    },
    ground: { base: 0x201c26, band: 0x2a2432, speckle: 0x3d3548, accent: 0x7d72a8, propStyle: "crystal" },
    particle: { kind: "dust", color: 0x9a90c0, density: 10 },
    weatherTint: { color: 0x241f34, alpha: 0.13 },
    scrollSpeed: { far: 9, near: 23 },
  },
];

const MAP1_BOSS: BiomeDef = {
  id: "map1-boss",
  nameTh: "รังผู้พิทักษ์ถ้ำ",
  special: "bossRoom",
  sky: { top: 0x0d0a12, bottom: 0x171220, horizon: 0xff8a3d },
  far: {
    color: 0x150f1c,
    alpha: 0.8,
    shape: "jagged-rock",
    amplitude: 62,
    density: 1.3,
    glowRim: 0xff8a3d,
  },
  ground: { base: 0x1a1420, band: 0x241a2c, speckle: 0x362840, accent: 0xff8a3d, propStyle: "ember" },
  particle: { kind: "ember", color: 0xff9a4d, density: 13 },
  weatherTint: { color: 0x1c1226, alpha: 0.16 },
  scrollSpeed: { far: 9, near: 24 },
};

// ---- map2: แดนอสูร (demon realm) — เขตชายแดนอสูร -> หนองเลือด -> ป่าอสูร ->
// ซากปรักหักพัง -> ประตูขุมนรก -> (boss) บัลลังก์อสูร. Reds/blacks deepening. ----

const MAP2_FARM: readonly BiomeDef[] = [
  {
    id: "map2-zone1",
    nameTh: "เขตชายแดนอสูร",
    sky: { top: 0x1f1418, bottom: 0x2e1c1f, horizon: 0xb5502c },
    far: { color: 0x2a1a1c, alpha: 0.6, shape: "jagged-rock", amplitude: 40, density: 0.9 },
    ground: { base: 0x2a1a18, band: 0x361f1c, speckle: 0x4a2a22, accent: 0x8a4a34, propStyle: "rock" },
    particle: { kind: "dust", color: 0xc98a6a, density: 9 },
    scrollSpeed: { far: 7, near: 20 },
  },
  {
    id: "map2-zone2",
    nameTh: "หนองเลือด",
    sky: { top: 0x220f14, bottom: 0x341a1e, horizon: 0xc23a2e },
    far: { color: 0x30161a, alpha: 0.65, shape: "jagged-rock", amplitude: 46, density: 1.0 },
    ground: { base: 0x30161a, band: 0x3d1e1f, speckle: 0x552422, accent: 0xb03327, propStyle: "ember" },
    particle: { kind: "ember", color: 0xd6432f, density: 10 },
    weatherTint: { color: 0x3a1418, alpha: 0.1 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map2-zone3",
    nameTh: "ป่าอสูร",
    sky: { top: 0x1c0e12, bottom: 0x2c161a, horizon: 0xd6432f },
    far: { color: 0x241215, alpha: 0.7, shape: "treeline", amplitude: 50, density: 1.15 },
    ground: { base: 0x281315, band: 0x35181a, speckle: 0x481f1f, accent: 0xcf3f2b, propStyle: "bush" },
    particle: { kind: "ember", color: 0xe0512f, density: 11 },
    weatherTint: { color: 0x3d1216, alpha: 0.12 },
    scrollSpeed: { far: 8, near: 22 },
  },
  {
    id: "map2-zone4",
    nameTh: "ซากปรักหักพัง",
    sky: { top: 0x160a0d, bottom: 0x260f13, horizon: 0xe0512f },
    far: {
      color: 0x1f0e11,
      alpha: 0.75,
      shape: "jagged-rock",
      amplitude: 56,
      density: 1.25,
      glowRim: 0xff6a3d,
    },
    ground: { base: 0x230f10, band: 0x301416, speckle: 0x451a1a, accent: 0xff5a33, propStyle: "rock" },
    particle: { kind: "ember", color: 0xff6a3d, density: 12 },
    weatherTint: { color: 0x420f10, alpha: 0.14 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "map2-zone5",
    nameTh: "ประตูขุมนรก",
    sky: { top: 0x110609, bottom: 0x1f0a0d, horizon: 0xff7a3d },
    far: {
      color: 0x180a0c,
      alpha: 0.8,
      shape: "volcanic-ridge",
      amplitude: 62,
      density: 1.3,
      glowRim: 0xff7a3d,
    },
    ground: { base: 0x1c0b0c, band: 0x270e10, speckle: 0x3a1414, accent: 0xff7a3d, propStyle: "ember" },
    particle: { kind: "ember", color: 0xff8a3d, density: 13 },
    weatherTint: { color: 0x4a0f10, alpha: 0.16 },
    scrollSpeed: { far: 9, near: 24 },
  },
];

const MAP2_BOSS: BiomeDef = {
  id: "map2-boss",
  nameTh: "บัลลังก์อสูร",
  special: "bossRoom",
  sky: { top: 0x0a0306, bottom: 0x180509, horizon: 0xff5a1e },
  far: {
    color: 0x120508,
    alpha: 0.85,
    shape: "volcanic-ridge",
    amplitude: 66,
    density: 1.4,
    glowRim: 0xff5a1e,
  },
  ground: { base: 0x160709, band: 0x200a0c, speckle: 0x330f0f, accent: 0xff5a1e, propStyle: "ember" },
  particle: { kind: "ember", color: 0xff6a2a, density: 15 },
  weatherTint: { color: 0x500a08, alpha: 0.2 },
  scrollSpeed: { far: 9, near: 24 },
};

// ---- map3: พรมแดนเถื่อน (wild frontier) — ทุ่งร้าง -> หุบผาหิน -> ดินแดนเถื่อน ->
// พายุทราย -> ปราการท้าย -> (boss) ป้อมปราการเถื่อน. Dusty ambers, thickening haze. ----

const MAP3_FARM: readonly BiomeDef[] = [
  {
    id: "map3-zone1",
    nameTh: "ทุ่งร้าง",
    sky: { top: 0x241f1a, bottom: 0x39312a, horizon: 0xd6a24a },
    far: { color: 0x2c261f, alpha: 0.55, shape: "rolling-hills", amplitude: 30, density: 0.7 },
    ground: { base: 0x332c22, band: 0x413728, speckle: 0x554635, accent: 0xb8934f, propStyle: "rock" },
    particle: { kind: "dust", color: 0xcdb37e, density: 9 },
    scrollSpeed: { far: 7, near: 19 },
  },
  {
    id: "map3-zone2",
    nameTh: "หุบผาหิน",
    sky: { top: 0x201c19, bottom: 0x332c26, horizon: 0xc98f4a },
    far: { color: 0x281f1a, alpha: 0.62, shape: "jagged-rock", amplitude: 44, density: 1.0 },
    ground: { base: 0x2c2419, band: 0x392e1f, speckle: 0x4a3c28, accent: 0xa87c42, propStyle: "rock" },
    particle: { kind: "dust", color: 0xc2a06a, density: 10 },
    weatherTint: { color: 0x2e2418, alpha: 0.08 },
    scrollSpeed: { far: 8, near: 20 },
  },
  {
    id: "map3-zone3",
    nameTh: "ดินแดนเถื่อน",
    sky: { top: 0x1c1815, bottom: 0x2c2620, horizon: 0xba7a3c },
    far: { color: 0x231c17, alpha: 0.68, shape: "jagged-rock", amplitude: 52, density: 1.15 },
    ground: { base: 0x261f16, band: 0x30271b, speckle: 0x413424, accent: 0x9c723a, propStyle: "rock" },
    particle: { kind: "dust", color: 0xba9a68, density: 10 },
    weatherTint: { color: 0x30271a, alpha: 0.1 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map3-zone4",
    nameTh: "พายุทราย",
    sky: { top: 0x1a1613, bottom: 0x2a231c, horizon: 0xd8a24a },
    far: { color: 0x1f1a15, alpha: 0.72, shape: "jagged-rock", amplitude: 56, density: 1.2 },
    ground: { base: 0x241d15, band: 0x2e2519, speckle: 0x3d3120, accent: 0xcaa254, propStyle: "rock" },
    particle: { kind: "dust", color: 0xe0c07a, density: 13 },
    weatherTint: { color: 0x3a2e1c, alpha: 0.18 },
    scrollSpeed: { far: 9, near: 22 },
  },
  {
    id: "map3-zone5",
    nameTh: "ปราการท้าย",
    sky: { top: 0x14100d, bottom: 0x211a15, horizon: 0xe0aa4a },
    far: {
      color: 0x191410,
      alpha: 0.76,
      shape: "jagged-rock",
      amplitude: 60,
      density: 1.3,
      glowRim: 0xffcf7a,
    },
    ground: { base: 0x1e1610, band: 0x281f15, speckle: 0x3a2c1a, accent: 0xd6a850, propStyle: "ember" },
    particle: { kind: "ember", color: 0xffcf7a, density: 12 },
    weatherTint: { color: 0x2c2114, alpha: 0.15 },
    scrollSpeed: { far: 9, near: 23 },
  },
];

const MAP3_BOSS: BiomeDef = {
  id: "map3-boss",
  nameTh: "ป้อมปราการเถื่อน",
  special: "bossRoom",
  sky: { top: 0x0e0b09, bottom: 0x1a1410, horizon: 0xffb54a },
  far: {
    color: 0x120e0b,
    alpha: 0.8,
    shape: "jagged-rock",
    amplitude: 64,
    density: 1.35,
    glowRim: 0xffb54a,
  },
  ground: { base: 0x171009, band: 0x22160c, speckle: 0x362613, accent: 0xffb54a, propStyle: "ember" },
  particle: { kind: "ember", color: 0xffc060, density: 14 },
  weatherTint: { color: 0x2c1c0a, alpha: 0.18 },
  scrollSpeed: { far: 9, near: 24 },
};

interface MapTheme {
  town?: BiomeDef;
  farm: readonly BiomeDef[];
  boss: BiomeDef;
}

const MAP_THEMES: Record<string, MapTheme> = {
  map1: { town: MAP1_TOWN, farm: MAP1_FARM, boss: MAP1_BOSS },
  map2: { farm: MAP2_FARM, boss: MAP2_BOSS },
  map3: { farm: MAP3_FARM, boss: MAP3_BOSS },
};

/** Darken a resolved biome a touch further for a same-map hue-loop repeat
 * (mirrors `biomeForStage`'s hue-shift trick, but map themes are curated
 * palettes so a small lightness nudge reads better than a hue rotation). */
function loopVariant(biome: BiomeDef, loop: number): BiomeDef {
  if (loop <= 0) return biome;
  const amount = -0.04 * loop;
  return {
    ...biome,
    ground: { ...biome.ground, base: adjustLightness(biome.ground.base, amount) },
    far: { ...biome.far, color: adjustLightness(biome.far.color, amount) },
  };
}

/**
 * Resolve a zone (see `engine/systems/world.ts`'s `Zone`, e.g. from
 * `zoneAt(state.location)`) to its themed biome. Town/boss are dedicated,
 * distinct biomes (never a repeat of a farm zone); farm zones escalate
 * through their map's family and loop with a lightness nudge if a map ever
 * hosts more farm zones than it has hand-authored variants for.
 */
export function biomeForZone(zone: Zone): ResolvedBiome {
  const theme = MAP_THEMES[zone.mapId];
  if (!theme) return biomeForStage(zone.stage); // frontier overflow — no theme authored yet

  if (zone.kind === "town" && theme.town) {
    return { ...theme.town, key: theme.town.id };
  }
  if (zone.kind === "boss") {
    return { ...theme.boss, key: theme.boss.id };
  }

  const hasTown = zone.mapId === CONFIG.world.townMapId && !!theme.town;
  const farmIdx = zone.zoneIdx - (hasTown ? 1 : 0);
  const n = theme.farm.length;
  const loop = Math.floor(farmIdx / Math.max(1, n));
  const base = theme.farm[((farmIdx % n) + n) % n];
  const resolved = loopVariant(base, loop);
  return { ...resolved, key: `${base.id}-${loop}` };
}
