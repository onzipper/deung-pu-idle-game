/**
 * `/lab` experiment ⑧ "refineLadder" — PURE recipe resolver: refine level +
 * item rarity → declarative pixel-fx layers. No Pixi/DOM imports (provably a
 * leaf module, same discipline as `pixelWeaponFx.ts`'s own header) so it's
 * unit-testable headless and safe to read as a design document.
 *
 * This file IS the design doc in code — every number below is an
 * owner-approved threshold/palette from the plan, not a placeholder:
 *
 *   rarity → element identity + palette (fade path top→bottom, flat colors):
 *     common    เศษประกายเหล็ก (motes)   ffffff → d7deee → 8a94ad → 525a70
 *     rare      ประกายฟ้า (sparkle)      ffffff → 9be3ff → 4fc3f7 → 1d6fa3
 *     epic      เปลวไฟอำพัน (flame)      ffffff → ffd166 → ffb347 → f3722c → 8c2f1b
 *     legendary ไฟทอง+วิบม่วง (2 layers) gold: ffffff→ffe9a8→f7d048→c9962e→7a5a1a
 *                                        violet: ffffff→d0a9ff→9d5cff→5b2ea6
 *
 *   refine +0..+10 (normal gear) — thresholds mirror the LIVE game's own
 *   aura/crackle/beat refine language (see CLAUDE.md "Live-game refine
 *   visual language"):
 *     +0-2   common/rare clean · epic already glows (faint flame wisp ×0.3)
 *     +3-4   sparse accent MOTES appear (rate ×0.5) — "เริ่มมีวี่แวว", a tell
 *            in the rarity color, deliberately NOT the element itself
 *     +5-6   motes steady (rate ×0.75)
 *     +7     IGNITE — the rarity ELEMENT itself turns on (kind change for
 *            rare/epic — the ladder's key visual beat; common's element IS
 *            motes, so common reads as a density jump instead)
 *     +8     denser/faster/wider (rate ×1.5, spread +30%)
 *     +9     + intermittent white-hot crackle micro-bolt (interval 1.6s)
 *     +10    + signature beat: rising ember column + tip-flare pulse (1.9s)
 *
 *   rarity intensity multiplier on every rate: common ×0.7, rare ×1.0, epic ×1.3.
 *
 *   legendary (slider becomes +0..+5), intensity ×1.5:
 *     +0     both layers already on (rate ×1.0)
 *     +1-2   rate ramps (×1.15 / ×1.3)
 *     +3     wider (spread +30%)
 *     +4     + crackle
 *     +5     + beat (gold-tinted)
 */

import type { ItemRarity } from "@/engine/config/items";

export type RefineFxLayerKind = "motes" | "sparkle" | "flame";

export interface RefineFxLayer {
  kind: RefineFxLayerKind;
  palette: readonly number[];
  /** particles/sec at density=1, burst=1 — the fx module scales this by its
   * own live density/swing-burst knobs; this is the recipe's BASE rate. */
  rate: number;
  /** world px the layer's spawn points walk back from the anchor, along the
   * blade line — mirrors `pixelWeaponFx.ts`'s own `SPAWN_SPREAD` default. */
  spread: number;
  sizeTexels: number;
}

export interface RefineFxCrackle {
  interval: number;
  palette: readonly number[];
}

export interface RefineFxBeat {
  columnPalette: readonly number[];
  flarePeriod: number;
}

export interface RefineFxRecipe {
  layers: RefineFxLayer[];
  crackle: RefineFxCrackle | null;
  beat: RefineFxBeat | null;
}

// ---------------------------------------------------------------------------
// Palettes (verbatim from the plan — flat shades, fade path top→bottom).
// ---------------------------------------------------------------------------

const RARITY_ACCENT: Record<ItemRarity, readonly number[]> = {
  common: [0xffffff, 0xd7deee, 0x8a94ad, 0x525a70],
  rare: [0xffffff, 0x9be3ff, 0x4fc3f7, 0x1d6fa3],
  epic: [0xffffff, 0xffd166, 0xffb347, 0xf3722c, 0x8c2f1b],
};

const LEGEND_GOLD_PALETTE: readonly number[] = [0xffffff, 0xffe9a8, 0xf7d048, 0xc9962e, 0x7a5a1a];
const LEGEND_VIOLET_PALETTE: readonly number[] = [0xffffff, 0xd0a9ff, 0x9d5cff, 0x5b2ea6];

const RARITY_ELEMENT: Record<ItemRarity, RefineFxLayerKind> = {
  common: "motes",
  rare: "sparkle",
  epic: "flame",
};

const RARITY_INTENSITY: Record<ItemRarity, number> = { common: 0.7, rare: 1.0, epic: 1.3 };
const LEGENDARY_INTENSITY = 1.5;

// "Fully ignited" (+7) base particles/sec + footprint per element kind — the
// per-rarity/per-refine multipliers below scale off these.
const BASE_RATE: Record<RefineFxLayerKind, number> = { motes: 5, sparkle: 4, flame: 18 };
const BASE_SIZE_TEXELS: Record<RefineFxLayerKind, number> = { motes: 1, sparkle: 1, flame: 1.5 };
const BASE_SPREAD = 24;

// ---------------------------------------------------------------------------
// Normal-gear refine ladder (+0..+10).
// ---------------------------------------------------------------------------

const EPIC_WISP_RATE_MULT = 0.3; // +0-2, epic-only "glows at +0" exception
const SPARSE_RATE_MULT = 0.5; // +3-4 "เริ่มมีวี่แวว"
const STEADY_RATE_MULT = 0.75; // +5-6 steady + occasional twinkle
const IGNITE_RATE_MULT = 1.0; // +7 IGNITE — fully on
const BOOST_RATE_MULT = 1.5; // +8..+10 denser/faster
const BOOST_SPREAD_MULT = 1.3; // +8..+10 wider

const CRACKLE_REFINE = 9;
const CRACKLE_INTERVAL = 1.6;
const CRACKLE_PALETTE: readonly number[] = [0xfffbe0, 0xffffff];

const BEAT_REFINE = 10;
const BEAT_FLARE_PERIOD = 1.9;
const BEAT_COLUMN_PALETTE: readonly number[] = [0xffe9a8, 0xfffbe0];

export const NORMAL_MAX_REFINE = 10;

/** Common-only element ramp — common's element IS motes, so its tell and its
 * ignite are the same layer walking one density ladder. */
function commonStageRateMult(refine: number): number {
  if (refine <= 2) return 0;
  if (refine <= 4) return SPARSE_RATE_MULT;
  if (refine <= 6) return STEADY_RATE_MULT;
  if (refine === 7) return IGNITE_RATE_MULT;
  return BOOST_RATE_MULT; // 8, 9, 10
}

function resolveNormalRecipe(rarity: ItemRarity, refineRaw: number): RefineFxRecipe {
  const refine = clampRefine(refineRaw, NORMAL_MAX_REFINE);
  const kind = RARITY_ELEMENT[rarity];
  const intensity = RARITY_INTENSITY[rarity];
  const spreadMult = refine >= 8 ? BOOST_SPREAD_MULT : 1;
  const layers: RefineFxLayer[] = [];

  // The rarity ELEMENT itself — IGNITEs at +7 as a KIND change for rare/epic
  // (the ladder's key visual beat, mirroring the live game's +7 aura gate).
  // Epic glows faint from +0 (its live aura is rarity-gated on, not refine-
  // gated); common's element is handled below as one motes ladder.
  const elementRateMult =
    kind === "motes"
      ? commonStageRateMult(refine)
      : refine >= 7
        ? refine >= 8
          ? BOOST_RATE_MULT
          : IGNITE_RATE_MULT
        : rarity === "epic"
          ? EPIC_WISP_RATE_MULT
          : 0;
  if (elementRateMult > 0) {
    layers.push({
      kind,
      palette: RARITY_ACCENT[rarity],
      rate: BASE_RATE[kind] * elementRateMult * intensity,
      spread: BASE_SPREAD * spreadMult,
      sizeTexels: BASE_SIZE_TEXELS[kind],
    });
  }

  // "เริ่มมีวี่แวว" accent-mote garnish from +3 for rare/epic — the pre-ignite
  // tell in the rarity color. Stays on after ignite (the ladder is cumulative
  // "added layers", and it keeps total rate monotonic across +6→+7).
  if (kind !== "motes" && refine >= 3) {
    layers.push({
      kind: "motes",
      palette: RARITY_ACCENT[rarity],
      rate: BASE_RATE.motes * (refine <= 4 ? SPARSE_RATE_MULT : STEADY_RATE_MULT) * intensity,
      spread: BASE_SPREAD * spreadMult,
      sizeTexels: BASE_SIZE_TEXELS.motes,
    });
  }

  return {
    layers,
    crackle: refine >= CRACKLE_REFINE ? { interval: CRACKLE_INTERVAL, palette: CRACKLE_PALETTE } : null,
    beat: refine >= BEAT_REFINE ? { columnPalette: BEAT_COLUMN_PALETTE, flarePeriod: BEAT_FLARE_PERIOD } : null,
  };
}

// ---------------------------------------------------------------------------
// Legendary "ตำนาน" awaken ladder (+0..+5) — TWO layers, gold flame + violet
// sparkle, both always present (owner call: a legendary never reads "off").
// ---------------------------------------------------------------------------

export const LEGENDARY_MAX_REFINE = 5;
const LEGEND_CRACKLE_REFINE = 4;
const LEGEND_BEAT_REFINE = 5;

/** Rate multiplier per awaken level 0..5 — ramps +1/+2, flat +3 (spread-only
 * change that level), flat +4/+5 (crackle/beat additions carry those levels
 * instead of a rate bump). Monotonically non-decreasing by construction. */
const LEGEND_RATE_MULT: readonly number[] = [1.0, 1.15, 1.3, 1.3, 1.3, 1.3];

function resolveLegendaryRecipe(refineRaw: number): RefineFxRecipe {
  const refine = clampRefine(refineRaw, LEGENDARY_MAX_REFINE);
  const rateMult = LEGEND_RATE_MULT[refine] ?? LEGEND_RATE_MULT[LEGEND_RATE_MULT.length - 1]!;
  const spreadMult = refine >= 3 ? BOOST_SPREAD_MULT : 1;

  const layers: RefineFxLayer[] = [
    {
      kind: "flame",
      palette: LEGEND_GOLD_PALETTE,
      rate: BASE_RATE.flame * rateMult * LEGENDARY_INTENSITY,
      spread: BASE_SPREAD * spreadMult,
      sizeTexels: BASE_SIZE_TEXELS.flame,
    },
    {
      kind: "sparkle",
      palette: LEGEND_VIOLET_PALETTE,
      rate: BASE_RATE.sparkle * rateMult * LEGENDARY_INTENSITY,
      spread: BASE_SPREAD * spreadMult,
      sizeTexels: BASE_SIZE_TEXELS.sparkle,
    },
  ];

  return {
    layers,
    crackle: refine >= LEGEND_CRACKLE_REFINE ? { interval: CRACKLE_INTERVAL, palette: CRACKLE_PALETTE } : null,
    beat: refine >= LEGEND_BEAT_REFINE ? { columnPalette: LEGEND_GOLD_PALETTE, flarePeriod: BEAT_FLARE_PERIOD } : null,
  };
}

// ---------------------------------------------------------------------------

/** `Math.max`/`Math.min`/`Math.round` clamp — footgun-3 habit (every number
 * that eventually reaches a Graphics draw call goes through a clamp
 * somewhere on its way; this is refine's). */
function clampRefine(v: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(v)));
}

/**
 * Resolve a declarative fx recipe for one weapon's current rarity + refine
 * (or legendary awaken) level. Pure function — no Pixi/render side effects;
 * `pixelWeaponFx.ts`'s `setRecipe` interprets the result into pooled
 * particles.
 */
export function resolveRefineFxRecipe(rarity: ItemRarity, refine: number, legendary: boolean): RefineFxRecipe {
  if (legendary) return resolveLegendaryRecipe(refine);
  return resolveNormalRecipe(rarity, refine);
}
