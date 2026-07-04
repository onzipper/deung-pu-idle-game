/**
 * Biome data — the single source of truth for the background system's visual
 * identity per stage. Pure data (no Pixi objects here); `environment/*` reads
 * these to build layers. See `render/README.md` "Art direction" section for
 * the full rationale.
 *
 * Shape language escalates with the biome order (rolling -> jagged -> sharp)
 * to echo the rising danger of later stages; hero/enemy animation (later
 * tasks) should echo the same escalation instead of introducing a new one.
 */

import { shiftHue } from "@/render/environment/colorUtils";

export type SilhouetteShape =
  | "rolling-hills"
  | "treeline"
  | "jagged-rock"
  | "volcanic-ridge"
  | "frost-peaks";

export type AmbientKind = "mote" | "leaf" | "dust" | "ember" | "snow";

export interface BiomeDef {
  /** Stable id (also used as the base React/Pixi key before variant suffixing). */
  id: string;
  /** Thai display name (unused in-canvas today, kept for a future biome toast). */
  nameTh: string;
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
    /** Scrolling foreground prop color (rocks/tufts/crystals/embers). */
    accent: number;
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

const MEADOW: BiomeDef = {
  id: "meadow",
  nameTh: "ทุ่งหญ้ายามเย็น",
  sky: { top: 0x1a2c4a, bottom: 0x2c3f5e, horizon: 0xe8a75d },
  far: {
    color: 0x24344a,
    alpha: 0.55,
    shape: "rolling-hills",
    amplitude: 26,
    density: 0.6,
  },
  ground: { base: 0x263a2e, band: 0x30492f, speckle: 0x3f5a3a, accent: 0x6fae4a },
  particle: { kind: "mote", color: 0xf2d98a, density: 10 },
  scrollSpeed: { far: 6, near: 18 },
};

const FOREST: BiomeDef = {
  id: "forest",
  nameTh: "ป่าทึบ",
  sky: { top: 0x111d24, bottom: 0x1c2f34, horizon: 0x6fa384 },
  far: {
    color: 0x152420,
    alpha: 0.65,
    shape: "treeline",
    amplitude: 46,
    density: 1.1,
  },
  ground: { base: 0x1e2a1e, band: 0x263323, speckle: 0x35452c, accent: 0xb4703a },
  particle: { kind: "leaf", color: 0xc98a3f, density: 9 },
  weatherTint: { color: 0x1f3a2c, alpha: 0.08 },
  scrollSpeed: { far: 8, near: 22 },
};

const CAVE: BiomeDef = {
  id: "cave",
  nameTh: "ถ้ำหินผา",
  sky: { top: 0x14131c, bottom: 0x211f30, horizon: 0x5a5478 },
  far: {
    color: 0x1c1a28,
    alpha: 0.7,
    shape: "jagged-rock",
    amplitude: 58,
    density: 1.3,
  },
  ground: { base: 0x211f28, band: 0x2b2836, speckle: 0x413c58, accent: 0x8f8ad0 },
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
  ground: { base: 0x231414, band: 0x321a17, speckle: 0x522119, accent: 0xff8a3d },
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
  ground: { base: 0x28323e, band: 0x384656, speckle: 0x54697c, accent: 0xdff3ff },
  particle: { kind: "snow", color: 0xf2fbff, density: 11 },
  weatherTint: { color: 0x2c4258, alpha: 0.1 },
  scrollSpeed: { far: 6, near: 18 },
};

/** Ordered biome loop: meadow -> forest -> cave/mountain -> volcanic -> frost,
 * then repeats with a hue-shifted variant (see `biomeForStage`). */
export const BIOMES: readonly BiomeDef[] = [MEADOW, FOREST, CAVE, VOLCANIC, FROST];

/** Hue rotation applied per full loop through `BIOMES`, so stage 6 (loop 1's
 * meadow) reads as a distinct twilight/dawn variant instead of an identical
 * repeat, without hand-authoring more raw palettes. */
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

/** A biome variant resolved for a specific stage — `key` is stable per
 * (biome, loop) pair, so `Environment` can detect "did the biome actually
 * change" without re-deriving the loop math itself. */
export interface ResolvedBiome extends BiomeDef {
  key: string;
}

/**
 * Map a 1-based stage number to a biome. Cycles through the 5 base biomes and
 * never "runs out" — every full loop through the list mints a hue-shifted
 * variant so long campaigns keep seeing new-ish scenery.
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
