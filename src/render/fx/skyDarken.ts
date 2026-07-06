/**
 * Cataclysm's brief sky-darken overlay (M7.7 "Skill Spectacle" tier-2
 * ultimate spectacle) — a single reusable full-bleed `Graphics` rect, same
 * "one shared shape" reasoning as `arenaFlash.ts`/`meteorScene.ts`'s sky
 * flash, but shaped as fade-IN -> HOLD -> fade-OUT (not a one-shot spike) so
 * it reads as "the sky darkening for a beat", not a flash. Flat alpha tint
 * only — footgun 10 (never additive over a bright daytime biome sky).
 */

import { Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** Real-seconds phase split — total ~0.85s, within the ultimate's ≤1.5s budget
 * alongside the impact beat it overlaps with. */
const FADE_IN = 0.15;
const HOLD = 0.4;
const FADE_OUT = 0.3;
const TOTAL = FADE_IN + HOLD + FADE_OUT;

export class SkyDarkenOverlay {
  private readonly g = new Graphics();
  private t = 0;
  private peak = 0;

  constructor(width: number, height: number, margin = 20) {
    this.g.rect(-margin, -margin, width + margin * 2, height + margin * 2).fill(0xffffff);
    this.g.alpha = 0;
    this.g.visible = false;
  }

  get view(): Graphics {
    return this.g;
  }

  /** Trigger (or extend, taking the brighter peak) the darken beat. */
  trigger(color: number, peakAlpha = 0.4): void {
    this.g.tint = color;
    this.peak = Math.max(this.peak, peakAlpha);
    this.t = TOTAL;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t = Math.max(0, this.t - dt);
    const elapsed = TOTAL - this.t;
    let frac: number;
    if (elapsed < FADE_IN) {
      frac = safeRadius(elapsed / FADE_IN);
    } else if (elapsed < FADE_IN + HOLD) {
      frac = 1;
    } else {
      frac = safeRadius(1 - (elapsed - FADE_IN - HOLD) / FADE_OUT);
    }
    this.g.alpha = this.peak * frac;
    if (this.t === 0) {
      this.g.visible = false;
      this.peak = 0;
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
