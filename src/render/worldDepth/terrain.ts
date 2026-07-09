/**
 * Cosmetic terrain heightmap for `/lab` experiment ⑨ "โลกมีมิติ" — pure math,
 * NO Pixi/DOM imports, so it's a provable promotion candidate (same rule as
 * `pixelWeaponFx`'s lab-era leaf-module contract).
 *
 * A terrain is `groundY(x)`: the ground line's screen-space y at world x.
 * It is built from a HAND-AUTHORED control-point offset table per preset
 * (deterministic — Math.random is banned here; the same preset always
 * produces the same hills), cosine-interpolated between control points every
 * `CONTROL_SPACING` px (cosine interp has zero slope AT the control points,
 * so crests/dips are naturally rounded), plus a small two-sine detail ripple
 * so long slopes don't read as ruler-straight.
 *
 * Contract (test-enforced in `src/lab/__tests__/worldDepthTerrain.test.ts`):
 *   - output clamped to [GROUND_Y + TERRAIN_MIN_OFFSET, GROUND_Y + TERRAIN_MAX_OFFSET]
 *     — the plan's headroom budget (feet + depth band must stay < WORLD_HEIGHT);
 *   - continuous: |Δy| per 1px well under 1.5 (worst-case analytic slope
 *     ≈ 0.5 px/px with the shipped tables/knobs);
 *   - x outside [0, worldW] clamps to the edge value (no cliff at the seam);
 *   - preset "flat" returns EXACTLY GROUND_Y everywhere (the A/B baseline).
 */

import { GROUND_Y } from "@/render/layout";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Highest the ground may rise above GROUND_Y (negative = up in screen space). */
export const TERRAIN_MIN_OFFSET = -28;
/** Lowest the ground may dip below GROUND_Y. */
export const TERRAIN_MAX_OFFSET = 10;

/** World-x distance between hand-authored control points. */
const CONTROL_SPACING = 150;

/** Detail ripple: two summed sines (amplitude px / wavelength-ish divisor).
 * Slope budget: 1.4/34 + 0.6/13 ≈ 0.09 px/px — tiny vs the 1.5 continuity cap. */
const DETAIL_AMP_A = 1.4;
const DETAIL_DIV_A = 34;
const DETAIL_AMP_B = 0.6;
const DETAIL_DIV_B = 13;

// ---------------------------------------------------------------------------
// Presets — offsets are px relative to GROUND_Y (negative = raised ground).
// Tables cycle (index mod length) so any worldW is covered. Values stay a
// couple px inside the clamp range so the detail ripple doesn't flat-top.
// ---------------------------------------------------------------------------

export type TerrainPresetId = "flat" | "hills" | "valley" | "plateau";

interface TerrainPresetDef {
  labelTh: string;
  /** Control-point offsets from GROUND_Y, one every CONTROL_SPACING px, cycled. */
  offsets: readonly number[];
  /** Detail-ripple master gain (0 = perfectly smooth, used by "flat"). */
  detailGain: number;
}

const PRESET_DEFS: Record<TerrainPresetId, TerrainPresetDef> = {
  // The A/B baseline: today's game. Exactly GROUND_Y, zero ripple.
  flat: { labelTh: "เรียบ", offsets: [0], detailGain: 0 },
  // Rolling bumps — frequent small crests with shallow saddles between.
  hills: {
    labelTh: "เนินเขา",
    offsets: [0, -10, -22, -14, -2, 4, -6, -24, -16, -4, 2, -12, -25, -8, 0, 6],
    detailGain: 1,
  },
  // One long basin per cycle — high shoulders easing down into a floor.
  valley: {
    labelTh: "หุบเขา",
    offsets: [-20, -25, -18, -8, 2, 7, 8, 7, 2, -8, -18, -24],
    detailGain: 1,
  },
  // Flat-topped mesas with sustained tops and low shelves between.
  plateau: {
    labelTh: "ที่ราบสูง",
    offsets: [0, 0, -23, -23, -23, -23, 0, 0, 6, 6, -19, -19, -19, 0],
    detailGain: 0.6,
  },
};

/** Preset list in display order for the experiment's Controls select. */
export const TERRAIN_PRESETS: readonly { id: TerrainPresetId; labelTh: string }[] = (
  ["flat", "hills", "valley", "plateau"] as const
).map((id) => ({ id, labelTh: PRESET_DEFS[id].labelTh }));

// ---------------------------------------------------------------------------
// Terrain factory
// ---------------------------------------------------------------------------

export interface Terrain {
  /** Ground line y at world x (x clamps to [0, worldW]). */
  groundY(x: number): number;
  /** Flat [x0,y0,x1,y1,...] sampling every `step` px over 0..worldW,
   * ALWAYS including the exact worldW endpoint. */
  polyline(step: number): number[];
}

/** Classic cosine interpolation: eases between a and b with zero end slope. */
function cosineInterp(a: number, b: number, t: number): number {
  const mu = (1 - Math.cos(t * Math.PI)) / 2;
  return a * (1 - mu) + b * mu;
}

export function createTerrain(preset: TerrainPresetId, worldW: number): Terrain {
  const def = PRESET_DEFS[preset];
  const yMin = GROUND_Y + TERRAIN_MIN_OFFSET;
  const yMax = GROUND_Y + TERRAIN_MAX_OFFSET;

  const groundY = (rawX: number): number => {
    // Flat is EXACT — the A/B "แบบเดิม" baseline must be bit-identical to today.
    if (preset === "flat") return GROUND_Y;
    const x = Math.max(0, Math.min(worldW, rawX));
    const seg = x / CONTROL_SPACING;
    const i = Math.floor(seg);
    const t = seg - i;
    const table = def.offsets;
    const a = table[i % table.length];
    const b = table[(i + 1) % table.length];
    const base = cosineInterp(a, b, t);
    const detail =
      def.detailGain *
      (DETAIL_AMP_A * Math.sin(x / DETAIL_DIV_A) + DETAIL_AMP_B * Math.sin(x / DETAIL_DIV_B));
    const y = GROUND_Y + base + detail;
    return Math.max(yMin, Math.min(yMax, y));
  };

  const polyline = (step: number): number[] => {
    const s = Math.max(1, step);
    const pts: number[] = [];
    for (let x = 0; x < worldW; x += s) {
      pts.push(x, groundY(x));
    }
    pts.push(worldW, groundY(worldW));
    return pts;
  };

  return { groundY, polyline };
}
