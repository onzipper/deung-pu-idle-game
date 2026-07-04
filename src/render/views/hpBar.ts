/**
 * Shared HP-bar drawing (hero / enemy / boss all use the same look: a dark
 * track + a colored fill that flips to `hpBad` under 35%, POC-faithful).
 */

import { Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

/** Redraws `g` in place as an HP bar centered at `cx`, top-left y `y`. */
export function drawHpBar(
  g: Graphics,
  cx: number,
  y: number,
  hp: number,
  maxHp: number,
  width = 34,
  height = 5,
): void {
  g.clear();
  const w = safeRadius(width);
  const h = safeRadius(height);
  const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const r = Math.min(2, h / 2);

  g.roundRect(cx - w / 2, y, w, h, r).fill({ color: PALETTE.shadow, alpha: 0.4 });
  if (pct > 0) {
    const fillColor = pct > 0.35 ? PALETTE.hpGood : PALETTE.hpBad;
    g.roundRect(cx - w / 2, y, w * pct, h, r).fill(fillColor);
  }
}
