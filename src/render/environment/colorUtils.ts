/**
 * Pure color-math helpers for the biome system. Deliberately NOT canvas
 * gradients (POC bug rule #2) — these operate on plain 0xRRGGBB numbers so
 * callers can precompute a handful of `Graphics` fills once per biome/chunk,
 * never touching `CanvasRenderingContext2D` at all.
 */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function toColor(r: number, g: number, b: number): number {
  const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
  }
  return { h: h * 60, s, l };
}

function hueToRgbChannel(p: number, q: number, t0: number): number {
  let t = t0;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hn = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToRgbChannel(p, q, hn + 1 / 3) * 255,
    g: hueToRgbChannel(p, q, hn) * 255,
    b: hueToRgbChannel(p, q, hn - 1 / 3) * 255,
  };
}

/** Rotate a color's hue by `degrees` (wraps), keeping saturation/lightness —
 * used to mint biome "loop variants" without hand-authoring new palettes. */
export function shiftHue(color: number, degrees: number): number {
  const { r, g, b } = toRgb(color);
  const hsl = rgbToHsl(r, g, b);
  const rotated = hslToRgb(hsl.h + degrees, hsl.s, hsl.l);
  return toColor(rotated.r, rotated.g, rotated.b);
}

/** Linear-interpolate between two colors, t in [0,1]. Used to build the
 * layered-rect "gradient" bands (a handful of flat-color rects, NOT a real
 * per-pixel gradient — see render/README's POC-bug rule #2). */
export function lerpColor(a: number, b: number, t: number): number {
  const ca = toRgb(a);
  const cb = toRgb(b);
  const clampedT = Math.max(0, Math.min(1, t));
  return toColor(
    ca.r + (cb.r - ca.r) * clampedT,
    ca.g + (cb.g - ca.g) * clampedT,
    ca.b + (cb.b - ca.b) * clampedT,
  );
}

/** Lighten (positive) or darken (negative) a color by `amount` in [-1,1]. */
export function adjustLightness(color: number, amount: number): number {
  const { r, g, b } = toRgb(color);
  const hsl = rgbToHsl(r, g, b);
  const l = Math.max(0, Math.min(1, hsl.l + amount));
  const rgb = hslToRgb(hsl.h, hsl.s, l);
  return toColor(rgb.r, rgb.g, rgb.b);
}
