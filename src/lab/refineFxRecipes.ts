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
 *
 *   "special-feel" wave (owner reviewed in-browser: "มาถูกทางแล้ว" but
 *   high-refine didn't feel SPECIAL yet — picked ALL FOUR proposed upgrades):
 *     molten blade      pixels CLING to the blade line itself (re-projected
 *                        from the CURRENT tip+dir every tick — see
 *                        `pixelWeaponFx.ts`'s `tickRecipeMolten`), slow
 *                        palette shimmer while attached; `dripRate>0` lets
 *                        pixels occasionally detach and fall with gravity.
 *                        normal +8 (drips +10) · legendary +3 (drips +5)
 *     swing afterimage   stepped ghost squares sampled from a per-instance
 *                        tip ring-buffer, only while a swing burst is active.
 *                        normal +9 · legendary +4
 *     charge→burst beat  3-phase cycle (inhale ring homes to the CURRENT tip
 *                        each tick → flash → radial burst) replacing the old
 *                        static ember-column + tip-flare pulse.
 *                        normal +10 · legendary +5
 *     world ambient      slow wide-radius embers around the whole character
 *                        + ground-level sparks (needs `setGroundY`).
 *                        normal +10 · legendary +5
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

/** +8..+10 (normal) / +3..+5 (legendary) — pixels CLINGING to the blade line
 * itself, re-projected from the CURRENT tip+dir every sim tick (see
 * `pixelWeaponFx.ts`'s `tickRecipeMolten`). `dripRate` is 0 until the drip
 * threshold (+10 normal / +5 legendary) — 0 means "clinging only, no drips". */
export interface RefineFxMolten {
  palette: readonly number[];
  countTexels: number;
  dripRate: number;
}

/** +9 (normal) / +4 (legendary) — stepped ghost squares sampled from the fx
 * module's per-instance tip ring-buffer, spawned only while a swing burst
 * window is active (`pixelWeaponFx.ts`'s `notifySwing`/`burstTicksLeft`). */
export interface RefineFxSwingTrail {
  palette: readonly number[];
}

/** +10 (normal) / +5 (legendary) — REWORK replacing the old static ember-
 * column + tip-flare pulse with a 3-phase anticipation→payoff beat: INHALE
 * (ring of particles homing toward the CURRENT tip) → FLASH (oversized plus
 * + bright blade-line squares) → BURST (radial pixels + a swing-style density
 * kick). `period` is the full inhale→flash→burst→quiet cycle length. */
export interface RefineFxBeat {
  kind: "chargeBurst";
  palette: readonly number[];
  period: number;
}

/** +10 (normal) / +5 (legendary) — "world-notice" presence: slow wide-radius
 * embers rising around the WHOLE character, plus ground-level spark pops
 * (the latter only fires once the host calls `setGroundY`; defaults off). */
export interface RefineFxAmbient {
  palette: readonly number[];
  emberRate: number;
  groundSparkRate: number;
}

export interface RefineFxRecipe {
  layers: RefineFxLayer[];
  crackle: RefineFxCrackle | null;
  molten: RefineFxMolten | null;
  swingTrail: RefineFxSwingTrail | null;
  beat: RefineFxBeat | null;
  ambient: RefineFxAmbient | null;
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

// ---- "special-feel" wave additions (owner: ALL FOUR picked) --------------

const MOLTEN_REFINE = 8;
const MOLTEN_DRIP_REFINE = 10;
const MOLTEN_COUNT_TEXELS = 8; // "~6-10 concurrent" per the plan
const MOLTEN_DRIP_RATE = 0.8; // detach events/sec once dripping turns on

const SWING_TRAIL_REFINE = 9;

const CHARGE_BURST_REFINE = 10;
const CHARGE_BURST_PERIOD = 2.4;
// Warm white/gold, same family as the old signature-beat palette — a
// deliberately NOT-rarity-tinted flourish (it's the ladder's own signature
// beat, not the element itself).
const CHARGE_BURST_PALETTE: readonly number[] = [0xffe9a8, 0xfffbe0, 0xffffff];

const AMBIENT_REFINE = 10;
const AMBIENT_EMBER_RATE = 0.6; // very low — "the world notices you", not a firework
const AMBIENT_GROUND_SPARK_RATE = 1.0;

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
    molten:
      refine >= MOLTEN_REFINE
        ? {
            palette: RARITY_ACCENT[rarity],
            countTexels: MOLTEN_COUNT_TEXELS,
            dripRate: refine >= MOLTEN_DRIP_REFINE ? MOLTEN_DRIP_RATE : 0,
          }
        : null,
    swingTrail: refine >= SWING_TRAIL_REFINE ? { palette: RARITY_ACCENT[rarity] } : null,
    beat:
      refine >= CHARGE_BURST_REFINE
        ? { kind: "chargeBurst", palette: CHARGE_BURST_PALETTE, period: CHARGE_BURST_PERIOD }
        : null,
    ambient:
      refine >= AMBIENT_REFINE
        ? {
            palette: RARITY_ACCENT[rarity],
            emberRate: AMBIENT_EMBER_RATE * intensity,
            groundSparkRate: AMBIENT_GROUND_SPARK_RATE * intensity,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Legendary "ตำนาน" awaken ladder (+0..+5) — TWO layers, gold flame + violet
// sparkle, both always present (owner call: a legendary never reads "off").
// ---------------------------------------------------------------------------

export const LEGENDARY_MAX_REFINE = 5;
const LEGEND_CRACKLE_REFINE = 4;

// ---- "special-feel" wave, legendary mapping (owner call, see plan) -------
// molten ≥3 (drips at 5) · swingTrail ≥4 · chargeBurst+ambient =5 · gold/
// violet palettes split across the new features the same way the two base
// layers already split them (molten=gold "molten metal", trail=violet,
// chargeBurst=gold, ambient=violet).
const LEGEND_MOLTEN_REFINE = 3;
const LEGEND_MOLTEN_DRIP_REFINE = 5;
const LEGEND_SWING_TRAIL_REFINE = 4;
const LEGEND_CHARGE_BURST_REFINE = 5;
const LEGEND_AMBIENT_REFINE = 5;

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
    molten:
      refine >= LEGEND_MOLTEN_REFINE
        ? {
            palette: LEGEND_GOLD_PALETTE,
            countTexels: MOLTEN_COUNT_TEXELS,
            dripRate: refine >= LEGEND_MOLTEN_DRIP_REFINE ? MOLTEN_DRIP_RATE : 0,
          }
        : null,
    swingTrail: refine >= LEGEND_SWING_TRAIL_REFINE ? { palette: LEGEND_VIOLET_PALETTE } : null,
    beat:
      refine >= LEGEND_CHARGE_BURST_REFINE
        ? { kind: "chargeBurst", palette: LEGEND_GOLD_PALETTE, period: CHARGE_BURST_PERIOD }
        : null,
    ambient:
      refine >= LEGEND_AMBIENT_REFINE
        ? {
            palette: LEGEND_VIOLET_PALETTE,
            emberRate: AMBIENT_EMBER_RATE * LEGENDARY_INTENSITY,
            groundSparkRate: AMBIENT_GROUND_SPARK_RATE * LEGENDARY_INTENSITY,
          }
        : null,
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
