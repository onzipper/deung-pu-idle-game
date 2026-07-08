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
  | "rooftops"
  // M7.9 "Grand Expansion" — map5 broken-civilization columns/arches, map6
  // infernal city towers (see `silhouettes.ts`'s `ruins`/`infernal-skyline`).
  | "ruins"
  | "infernal-skyline";

export type AmbientKind = "mote" | "leaf" | "dust" | "ember" | "snow" | "smoke";

/** Which shared prop vocabulary `groundProps.ts` draws for this biome's near
 * layer — decoupled from `id` so many map-specific biome ids can reuse the
 * same handful of hand-built prop shapes instead of a per-id switch. */
export type PropStyle =
  | "grass"
  | "bush"
  | "rock"
  | "crystal"
  | "ember"
  | "town"
  // M7.9 — map4 snow drifts, map5 ruin rubble, map6 dark ground cracks.
  | "snow"
  | "rubble"
  | "cracks";

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

// ---- map4: ทุนดราน้ำแข็ง (ice tundra, s16-20) — ทุ่งน้ำแข็งเปิดโล่ง -> ป่าสนแช่แข็ง ->
// หุบเขาน้ำแข็ง -> พายุหิมะ -> ธารน้ำแข็งอันตราย -> (boss) บัลลังก์น้ำแข็งนิรันดร์.
// Frozen ground, snow-drift near layer, pale cold light deepening toward a
// blue-white glacial glow. ----

const MAP4_FARM: readonly BiomeDef[] = [
  {
    id: "map4-zone1",
    nameTh: "ทุ่งน้ำแข็งเปิดโล่ง",
    sky: { top: 0x1c2838, bottom: 0x2e4258, horizon: 0xbfe0f5 },
    far: { color: 0x25384c, alpha: 0.55, shape: "frost-peaks", amplitude: 30, density: 0.7 },
    ground: { base: 0x28323e, band: 0x37485a, speckle: 0x4c6072, accent: 0xdff3ff, propStyle: "snow" },
    particle: { kind: "snow", color: 0xf2fbff, density: 10 },
    scrollSpeed: { far: 7, near: 19 },
  },
  {
    id: "map4-zone2",
    nameTh: "ป่าสนแช่แข็ง",
    sky: { top: 0x18222f, bottom: 0x263a4e, horizon: 0xaad4f0 },
    far: { color: 0x1e2d3c, alpha: 0.6, shape: "treeline", amplitude: 40, density: 0.9 },
    ground: { base: 0x232e39, band: 0x30414f, speckle: 0x455868, accent: 0xcdeaff, propStyle: "snow" },
    particle: { kind: "snow", color: 0xeaf6ff, density: 10 },
    weatherTint: { color: 0x1f3242, alpha: 0.08 },
    scrollSpeed: { far: 8, near: 20 },
  },
  {
    id: "map4-zone3",
    nameTh: "หุบเขาน้ำแข็ง",
    sky: { top: 0x121a24, bottom: 0x1f2f3f, horizon: 0x8fc4e8 },
    far: {
      color: 0x18232e,
      alpha: 0.68,
      shape: "jagged-rock",
      amplitude: 50,
      density: 1.1,
      glowRim: 0xbfe6ff,
    },
    ground: { base: 0x1c2530, band: 0x28323f, speckle: 0x3c4d5c, accent: 0xbfe6ff, propStyle: "crystal" },
    particle: { kind: "dust", color: 0xb9d8ec, density: 9 },
    weatherTint: { color: 0x1a2836, alpha: 0.1 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map4-zone4",
    nameTh: "พายุหิมะ",
    sky: { top: 0x0e141c, bottom: 0x1a2836, horizon: 0xdff3ff },
    far: {
      color: 0x162230,
      alpha: 0.74,
      shape: "frost-peaks",
      amplitude: 58,
      density: 1.2,
      glowRim: 0xeaf8ff,
    },
    ground: { base: 0x1a232d, band: 0x263241, speckle: 0x3a4a5c, accent: 0xeaf8ff, propStyle: "snow" },
    particle: { kind: "snow", color: 0xf5fbff, density: 13 },
    weatherTint: { color: 0x2a3a4a, alpha: 0.2 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "map4-zone5",
    nameTh: "ธารน้ำแข็งอันตราย",
    sky: { top: 0x0a0f16, bottom: 0x141f2c, horizon: 0x9fdfff },
    far: {
      color: 0x101a24,
      alpha: 0.78,
      shape: "frost-peaks",
      amplitude: 64,
      density: 1.3,
      glowRim: 0x9fdfff,
    },
    ground: { base: 0x161f28, band: 0x212c38, speckle: 0x34455a, accent: 0x9fdfff, propStyle: "crystal" },
    particle: { kind: "snow", color: 0xdff3ff, density: 12 },
    weatherTint: { color: 0x16222e, alpha: 0.14 },
    scrollSpeed: { far: 9, near: 24 },
  },
];

const MAP4_BOSS: BiomeDef = {
  id: "map4-boss",
  nameTh: "บัลลังก์น้ำแข็งนิรันดร์",
  special: "bossRoom",
  sky: { top: 0x05080d, bottom: 0x0f1a24, horizon: 0x7fd4ff },
  far: {
    color: 0x0b131a,
    alpha: 0.84,
    shape: "frost-peaks",
    amplitude: 70,
    density: 1.4,
    glowRim: 0x7fd4ff,
  },
  ground: { base: 0x0e161d, band: 0x18232d, speckle: 0x2c3c4c, accent: 0x7fd4ff, propStyle: "crystal" },
  particle: { kind: "snow", color: 0xcdeeff, density: 15 },
  weatherTint: { color: 0x0c1822, alpha: 0.22 },
  scrollSpeed: { far: 9, near: 24 },
};

// ---- map5: ทะเลทรายซากอารยธรรม (desert ruins, s21-25) — ทะเลทรายเริ่มต้น ->
// ซากปรักคาราวาน -> ซุ้มประตูโบราณ -> พายุทรายซากเมือง -> ประตูสู่นครฝังทราย ->
// (boss) บัลลังก์นครโบราณ. Dunes + broken civilization silhouettes (columns/
// arches), warm heat-haze palette thickening toward the buried city. ----

const MAP5_FARM: readonly BiomeDef[] = [
  {
    id: "map5-zone1",
    nameTh: "ทะเลทรายเริ่มต้น",
    sky: { top: 0x2a2018, bottom: 0x40301f, horizon: 0xe8a748 },
    far: { color: 0x33281c, alpha: 0.5, shape: "rolling-hills", amplitude: 26, density: 0.6 },
    ground: { base: 0x3a2e1e, band: 0x4a3a24, speckle: 0x5c4830, accent: 0xd6a24a, propStyle: "rubble" },
    particle: { kind: "dust", color: 0xe0c07a, density: 10 },
    scrollSpeed: { far: 7, near: 19 },
  },
  {
    id: "map5-zone2",
    nameTh: "ซากปรักคาราวาน",
    sky: { top: 0x241c15, bottom: 0x392c1d, horizon: 0xd89a3c },
    far: { color: 0x2c2318, alpha: 0.58, shape: "rolling-hills", amplitude: 34, density: 0.8 },
    ground: { base: 0x332619, band: 0x413221, speckle: 0x53422c, accent: 0xc79148, propStyle: "rubble" },
    particle: { kind: "dust", color: 0xd6b171, density: 11 },
    weatherTint: { color: 0x3a2c1a, alpha: 0.1 },
    scrollSpeed: { far: 8, near: 20 },
  },
  {
    id: "map5-zone3",
    nameTh: "ซุ้มประตูโบราณ",
    sky: { top: 0x1e1712, bottom: 0x30251a, horizon: 0xc9843a },
    far: { color: 0x261d15, alpha: 0.65, shape: "ruins", amplitude: 46, density: 0.9 },
    ground: { base: 0x2c2116, band: 0x392c1d, speckle: 0x4a3a26, accent: 0xb8853e, propStyle: "rubble" },
    particle: { kind: "dust", color: 0xcaa06a, density: 12 },
    weatherTint: { color: 0x3c2c18, alpha: 0.14 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map5-zone4",
    nameTh: "พายุทรายซากเมือง",
    sky: { top: 0x191310, bottom: 0x281e15, horizon: 0xe0aa4a },
    far: {
      color: 0x201810,
      alpha: 0.7,
      shape: "ruins",
      amplitude: 54,
      density: 1.05,
      glowRim: 0xffcf7a,
    },
    ground: { base: 0x241b12, band: 0x30251a, speckle: 0x413020, accent: 0xe0aa4a, propStyle: "rubble" },
    particle: { kind: "dust", color: 0xe8c27e, density: 14 },
    weatherTint: { color: 0x4a3418, alpha: 0.22 },
    scrollSpeed: { far: 9, near: 22 },
  },
  {
    id: "map5-zone5",
    nameTh: "ประตูสู่นครฝังทราย",
    sky: { top: 0x140f0b, bottom: 0x201811, horizon: 0xffcf7a },
    far: {
      color: 0x1a130d,
      alpha: 0.76,
      shape: "ruins",
      amplitude: 60,
      density: 1.15,
      glowRim: 0xffcf7a,
    },
    ground: { base: 0x1e1610, band: 0x2a2015, speckle: 0x3c2e1c, accent: 0xffcf7a, propStyle: "rubble" },
    particle: { kind: "ember", color: 0xffcf7a, density: 12 },
    weatherTint: { color: 0x3a2814, alpha: 0.18 },
    scrollSpeed: { far: 9, near: 23 },
  },
];

const MAP5_BOSS: BiomeDef = {
  id: "map5-boss",
  nameTh: "บัลลังก์นครโบราณ",
  special: "bossRoom",
  sky: { top: 0x0d0906, bottom: 0x1a130d, horizon: 0xff9a3d },
  far: {
    color: 0x120d08,
    alpha: 0.82,
    shape: "ruins",
    amplitude: 66,
    density: 1.3,
    glowRim: 0xff9a3d,
  },
  ground: { base: 0x160f09, band: 0x20160d, speckle: 0x362513, accent: 0xff9a3d, propStyle: "rubble" },
  particle: { kind: "ember", color: 0xffab4d, density: 15 },
  weatherTint: { color: 0x3a2410, alpha: 0.2 },
  scrollSpeed: { far: 9, near: 24 },
};

// ---- map6: นครนรก (hell city, s26-30) — ประตูเมืองไฟนรก -> ถนนเถ้าถ่าน ->
// ตรอกวิญญาณ -> จัตุรัสเปลวเพลิง -> ประตูสู่บัลลังก์อสูรร้าย -> (boss)
// บัลลังก์อสูรจอมเพลิง. Infernal city skyline, ember glow, dark ground
// cracks deepening to near-black + hottest ember accent. ----

const MAP6_FARM: readonly BiomeDef[] = [
  {
    id: "map6-zone1",
    nameTh: "ประตูเมืองไฟนรก",
    sky: { top: 0x140508, bottom: 0x220a0d, horizon: 0xff5a1e },
    far: {
      color: 0x1a070a,
      alpha: 0.6,
      shape: "infernal-skyline",
      amplitude: 50,
      density: 0.8,
      glowRim: 0xff5a1e,
    },
    ground: { base: 0x1c0a0a, band: 0x2a1010, speckle: 0x3f1614, accent: 0xff5a1e, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xff6a2a, density: 11 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "map6-zone2",
    nameTh: "ถนนเถ้าถ่าน",
    sky: { top: 0x120406, bottom: 0x1e080a, horizon: 0xff4a1e },
    far: {
      color: 0x170608,
      alpha: 0.66,
      shape: "infernal-skyline",
      amplitude: 56,
      density: 0.95,
      glowRim: 0xff4a1e,
    },
    ground: { base: 0x190808, band: 0x260d0d, speckle: 0x3a1412, accent: 0xff4a1e, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xff5a22, density: 12 },
    weatherTint: { color: 0x2c0808, alpha: 0.12 },
    scrollSpeed: { far: 8, near: 22 },
  },
  {
    id: "map6-zone3",
    nameTh: "ตรอกวิญญาณ",
    sky: { top: 0x0f0304, bottom: 0x1a0608, horizon: 0xff3a1a },
    far: {
      color: 0x140506,
      alpha: 0.72,
      shape: "infernal-skyline",
      amplitude: 60,
      density: 1.1,
      glowRim: 0xff3a1a,
    },
    ground: { base: 0x160707, band: 0x220a0a, speckle: 0x361211, accent: 0xff3a1a, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xff4a1e, density: 13 },
    weatherTint: { color: 0x330808, alpha: 0.15 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "map6-zone4",
    nameTh: "จัตุรัสเปลวเพลิง",
    sky: { top: 0x0c0203, bottom: 0x160406, horizon: 0xff2e14 },
    far: {
      color: 0x110304,
      alpha: 0.77,
      shape: "infernal-skyline",
      amplitude: 64,
      density: 1.2,
      glowRim: 0xff2e14,
    },
    ground: { base: 0x130505, band: 0x1e0808, speckle: 0x321010, accent: 0xff2e14, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xff3a18, density: 14 },
    weatherTint: { color: 0x3c0808, alpha: 0.18 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "map6-zone5",
    nameTh: "ประตูสู่บัลลังก์อสูรร้าย",
    sky: { top: 0x090103, bottom: 0x120305, horizon: 0xff220f },
    far: {
      color: 0x0d0203,
      alpha: 0.8,
      shape: "infernal-skyline",
      amplitude: 68,
      density: 1.3,
      glowRim: 0xff220f,
    },
    ground: { base: 0x100404, band: 0x1a0606, speckle: 0x2e0e0e, accent: 0xff220f, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xff2e12, density: 15 },
    weatherTint: { color: 0x460606, alpha: 0.2 },
    scrollSpeed: { far: 9, near: 24 },
  },
];

const MAP6_BOSS: BiomeDef = {
  id: "map6-boss",
  nameTh: "บัลลังก์อสูรจอมเพลิง",
  special: "bossRoom",
  sky: { top: 0x060001, bottom: 0x0e0203, horizon: 0xff1a0a },
  far: {
    color: 0x080102,
    alpha: 0.86,
    shape: "infernal-skyline",
    amplitude: 72,
    density: 1.4,
    glowRim: 0xff1a0a,
  },
  ground: { base: 0x0b0303, band: 0x150505, speckle: 0x280c0c, accent: 0xff1a0a, propStyle: "cracks" },
  particle: { kind: "ember", color: 0xff260e, density: 17 },
  weatherTint: { color: 0x520606, alpha: 0.24 },
  scrollSpeed: { far: 9, near: 24 },
};

// ---- ดินแดนอสูร (ASURA, endgame v1, docs/endgame-design.md, s31-40) — the 7th
// map: 10 farm zones (no town — `CONFIG.asura.mapId !== CONFIG.world.townMapId`)
// deepening a corrupted dark-red/violet demonic re-tint, escalating toward a
// capstone throne. Reuses the SAME environment machinery (sky/far/ground/
// particle/weatherTint layering, `AmbientKind`/`PropStyle`/`SilhouetteShape`
// vocabularies — no new enum members) every other map theme does; only the
// palette/shape CHOICES are new. Deliberately a DIFFERENT hue family from
// map2's "แดนอสูร" (fiery orange-red) — a deep BLOOD-VIOLET corruption so the
// two never read as the same place, even though both are "demon" themed.
// `enemySpecies.ts`'s asura mob species (reused map6 silhouettes, recolored)
// carry the rest of the "corrupted, familiar" read on top of this backdrop. ----

const ASURA_FARM: readonly BiomeDef[] = [
  {
    id: "asura-zone1",
    nameTh: "ประตูมิติร้าว",
    sky: { top: 0x1a0a1c, bottom: 0x28122c, horizon: 0xb5486a },
    far: { color: 0x230e28, alpha: 0.6, shape: "jagged-rock", amplitude: 40, density: 0.85 },
    ground: { base: 0x28102a, band: 0x341636, speckle: 0x481f4a, accent: 0xa8355a, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xd6547a, density: 9 },
    scrollSpeed: { far: 7, near: 20 },
  },
  {
    id: "asura-zone2",
    nameTh: "ทุ่งเถ้ากระดูก",
    sky: { top: 0x160916, bottom: 0x230f22, horizon: 0xaa3e64 },
    far: { color: 0x1e0c1e, alpha: 0.64, shape: "jagged-rock", amplitude: 44, density: 0.95 },
    ground: { base: 0x230d20, band: 0x2e122a, speckle: 0x42193a, accent: 0x9c2f52, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xcc4a6e, density: 10 },
    weatherTint: { color: 0x2c0e26, alpha: 0.09 },
    scrollSpeed: { far: 7, near: 20 },
  },
  {
    id: "asura-zone3",
    nameTh: "หนองเลือดดำ",
    sky: { top: 0x120711, bottom: 0x1d0c1c, horizon: 0x9c3660 },
    far: { color: 0x190a1a, alpha: 0.68, shape: "infernal-skyline", amplitude: 48, density: 1.0 },
    ground: { base: 0x1e0b1c, band: 0x281024, speckle: 0x3a1632, accent: 0x8f2a4e, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xbf3f66, density: 11 },
    weatherTint: { color: 0x2a0c22, alpha: 0.11 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "asura-zone4",
    nameTh: "ป่าจิตวิญญาณอสูร",
    sky: { top: 0x0f0610, bottom: 0x190a19, horizon: 0x8a2f5c },
    far: { color: 0x150819, alpha: 0.71, shape: "infernal-skyline", amplitude: 52, density: 1.05 },
    ground: { base: 0x190a1c, band: 0x230e26, speckle: 0x341334, accent: 0x82295a, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xb03a68, density: 12 },
    weatherTint: { color: 0x2c0c28, alpha: 0.13 },
    scrollSpeed: { far: 8, near: 21 },
  },
  {
    id: "asura-zone5",
    nameTh: "ซากปรักปีศาจ",
    sky: { top: 0x0c050f, bottom: 0x160816, horizon: 0x7c2a5c },
    far: {
      color: 0x130717,
      alpha: 0.74,
      shape: "jagged-rock",
      amplitude: 56,
      density: 1.12,
      glowRim: 0xc03a70,
    },
    ground: { base: 0x160918, band: 0x200c22, speckle: 0x301230, accent: 0xc03a70, propStyle: "ember" },
    particle: { kind: "ember", color: 0xc03a70, density: 12 },
    weatherTint: { color: 0x300e2c, alpha: 0.15 },
    scrollSpeed: { far: 8, near: 22 },
  },
  {
    id: "asura-zone6",
    nameTh: "แดนคำสาป",
    sky: { top: 0x0a0410, bottom: 0x130715, horizon: 0x6e2560 },
    far: {
      color: 0x100616,
      alpha: 0.76,
      shape: "infernal-skyline",
      amplitude: 60,
      density: 1.18,
      glowRim: 0xc03a78,
    },
    ground: { base: 0x130818, band: 0x1c0c22, speckle: 0x2c1230, accent: 0xc03a78, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xc23a7a, density: 13 },
    weatherTint: { color: 0x330e2e, alpha: 0.17 },
    scrollSpeed: { far: 9, near: 22 },
  },
  {
    id: "asura-zone7",
    nameTh: "หุบเหวมนตร์ดำ",
    sky: { top: 0x080310, bottom: 0x100616, horizon: 0x651f66 },
    far: {
      color: 0x0d0518,
      alpha: 0.78,
      shape: "jagged-rock",
      amplitude: 62,
      density: 1.22,
      glowRim: 0xc73a88,
    },
    ground: { base: 0x100618, band: 0x190a24, speckle: 0x281032, accent: 0xc73a88, propStyle: "ember" },
    particle: { kind: "ember", color: 0xc73a88, density: 14 },
    weatherTint: { color: 0x360f34, alpha: 0.19 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "asura-zone8",
    nameTh: "มหาสมุทรเถ้าอสูร",
    sky: { top: 0x060212, bottom: 0x0d0518, horizon: 0x5c1a6c },
    far: {
      color: 0x0a0418,
      alpha: 0.8,
      shape: "infernal-skyline",
      amplitude: 65,
      density: 1.26,
      glowRim: 0xcf3d98,
    },
    ground: { base: 0x0d0518, band: 0x160828, speckle: 0x241038, accent: 0xcf3d98, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xcf3d98, density: 14 },
    weatherTint: { color: 0x3a103a, alpha: 0.2 },
    scrollSpeed: { far: 9, near: 23 },
  },
  {
    id: "asura-zone9",
    nameTh: "แท่นพิพากษาบาป",
    sky: { top: 0x050113, bottom: 0x0b041a, horizon: 0x531572 },
    far: {
      color: 0x08031a,
      alpha: 0.83,
      shape: "jagged-rock",
      amplitude: 68,
      density: 1.3,
      glowRim: 0xd63fa8,
    },
    ground: { base: 0x0b041a, band: 0x14072c, speckle: 0x220f3e, accent: 0xd63fa8, propStyle: "ember" },
    particle: { kind: "ember", color: 0xd63fa8, density: 15 },
    weatherTint: { color: 0x3e1140, alpha: 0.21 },
    scrollSpeed: { far: 9, near: 24 },
  },
  {
    id: "asura-zone10",
    nameTh: "ธรณีประตูอวสาน",
    sky: { top: 0x04010f, bottom: 0x09031a, horizon: 0x4a107a },
    far: {
      color: 0x06021c,
      alpha: 0.85,
      shape: "infernal-skyline",
      amplitude: 70,
      density: 1.34,
      glowRim: 0xde42b8,
    },
    ground: { base: 0x08031c, band: 0x11062e, speckle: 0x1e0e42, accent: 0xde42b8, propStyle: "cracks" },
    particle: { kind: "ember", color: 0xde42b8, density: 15 },
    weatherTint: { color: 0x421248, alpha: 0.23 },
    scrollSpeed: { far: 9, near: 24 },
  },
];

const ASURA_BOSS: BiomeDef = {
  id: "asura-boss",
  nameTh: "แท่นบัลลังก์จอมอสูรวิปริต",
  special: "bossRoom",
  sky: { top: 0x030010, bottom: 0x07021a, horizon: 0x420d80 },
  far: {
    color: 0x05011c,
    alpha: 0.88,
    shape: "infernal-skyline",
    amplitude: 74,
    density: 1.4,
    glowRim: 0xe84ac8,
  },
  ground: { base: 0x06021e, band: 0x0f0530, speckle: 0x1c0d46, accent: 0xe84ac8, propStyle: "cracks" },
  particle: { kind: "ember", color: 0xe84ac8, density: 17 },
  weatherTint: { color: 0x4a1350, alpha: 0.26 },
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
  map4: { farm: MAP4_FARM, boss: MAP4_BOSS },
  map5: { farm: MAP5_FARM, boss: MAP5_BOSS },
  map6: { farm: MAP6_FARM, boss: MAP6_BOSS },
  [CONFIG.asura.mapId]: { farm: ASURA_FARM, boss: ASURA_BOSS },
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
