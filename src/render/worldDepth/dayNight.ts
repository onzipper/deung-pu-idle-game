/**
 * Day/night palette cycle for `/lab` experiment ⑨ "โลกมีมิติ" — pure math on
 * 0xRRGGBB numbers (via render's `lerpColor`, itself pure — the allowed
 * lab→render import direction). NO Pixi/DOM.
 *
 * `samplePalette(t)` maps a cycle phase t (any real; wraps into [0,1)) to a
 * `DayPalette` by lerping between 4 hand-authored keyframes:
 *
 *     t=0.00 เช้า      soft warm sunrise wash
 *     t=0.25 เที่ยง    NEUTRAL — all tints exactly 0xffffff, overlay off.
 *                      This is the A/B baseline: "living world off" freezes
 *                      the scene at noon and must look exactly like today.
 *     t=0.50 ค่ำ       orange-purple dusk
 *     t=0.75 กลางคืน   deep blue night, nightness 1 (fireflies fade in on
 *                      this channel), overlay at its 0.35 ceiling
 *
 * Consumers: sky/strata containers tint with skyTint/ambientTint, a
 * screen-fixed overlay rect uses overlayColor/overlayAlpha, and critters read
 * `nightness` (0 = full day … 1 = full night). overlayAlpha is clamped to
 * [0, OVERLAY_ALPHA_MAX] so gameplay silhouettes never drown (test-enforced).
 */

import { lerpColor } from "@/render/environment/colorUtils";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Hard ceiling for the night overlay — keep the action readable. */
export const OVERLAY_ALPHA_MAX = 0.35;

/** Length of one accelerated day/night cycle, ms. Owner call: 30 min/day, run
 * off a shared wall clock (Date.now()) so every client sees the SAME phase —
 * no per-save state, no hash surface (render-only). */
export const DAY_MS = 30 * 60 * 1000;

/**
 * Wall-clock ms → cycle phase in [0,1) for `samplePalette` (t=0 เช้า … 0.25
 * เที่ยง … 0.5 ค่ำ … 0.75 กลางคืน). Pure/deterministic in its argument; the
 * caller supplies Date.now() (or a fixed value in tests). Handles negative ms.
 */
export function cyclePhase(nowMs: number): number {
  return ((((nowMs % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS);
}

export interface DayPalette {
  /** Tint for the screen-fixed sky backdrop. */
  skyTint: number;
  /** Tint for the world strata / entities container. */
  ambientTint: number;
  /** Color of the full-screen mood overlay rect. */
  overlayColor: number;
  /** Overlay alpha ∈ [0, OVERLAY_ALPHA_MAX]. */
  overlayAlpha: number;
  /** 0 = full day … 1 = full night (drives fireflies etc.). */
  nightness: number;
}

/** The 4 keyframes at t = 0, 0.25, 0.5, 0.75 (equally spaced, cycle wraps). */
const KEYFRAMES: readonly DayPalette[] = [
  // เช้า — soft warm sunrise
  {
    skyTint: 0xffe3c4,
    ambientTint: 0xfff2e0,
    overlayColor: 0xff9a5c,
    overlayAlpha: 0.08,
    nightness: 0.1,
  },
  // เที่ยง — exact neutral (the "living world off" freeze frame)
  {
    skyTint: 0xffffff,
    ambientTint: 0xffffff,
    overlayColor: 0xffffff,
    overlayAlpha: 0,
    nightness: 0,
  },
  // ค่ำ — orange-purple dusk
  {
    skyTint: 0xf59a6b,
    ambientTint: 0xe8a685,
    overlayColor: 0x6b3fa0,
    overlayAlpha: 0.18,
    nightness: 0.45,
  },
  // กลางคืน — deep blue night
  {
    skyTint: 0x3b4a86,
    ambientTint: 0x8a97c8,
    overlayColor: 0x101c4a,
    overlayAlpha: OVERLAY_ALPHA_MAX,
    nightness: 1,
  },
];

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Wrap any real t into [0,1) and lerp the two neighboring keyframes.
 *
 * Pass `out` from per-frame callers — it is mutated and returned, so the
 * render loop allocates nothing. Omitting it allocates a fresh object (tests,
 * frozen snapshots like the experiment's noon baseline).
 */
export function samplePalette(t: number, out?: DayPalette): DayPalette {
  const wrapped = ((t % 1) + 1) % 1;
  const seg = wrapped * KEYFRAMES.length;
  const i = Math.floor(seg) % KEYFRAMES.length;
  const j = (i + 1) % KEYFRAMES.length;
  const f = seg - Math.floor(seg);
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[j];
  const o = out ?? { skyTint: 0, ambientTint: 0, overlayColor: 0, overlayAlpha: 0, nightness: 0 };
  o.skyTint = lerpColor(a.skyTint, b.skyTint, f);
  o.ambientTint = lerpColor(a.ambientTint, b.ambientTint, f);
  o.overlayColor = lerpColor(a.overlayColor, b.overlayColor, f);
  o.overlayAlpha = Math.max(0, Math.min(OVERLAY_ALPHA_MAX, lerp(a.overlayAlpha, b.overlayAlpha, f)));
  o.nightness = lerp(a.nightness, b.nightness, f);
  return o;
}
