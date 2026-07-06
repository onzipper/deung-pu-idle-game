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

/** Real-seconds phase split — total ~0.85s (default hold), within the
 * ultimate's ≤1.5s budget alongside the impact beat it overlaps with. M7.9
 * "Grand Expansion" lets a caller request a longer HOLD (`trigger()`'s third
 * arg) for the tier-3 skill-4s (archer STORM's ~4s sustained sky, mage
 * APOCALYPSE's much-longer-than-cataclysm hold) without touching FADE_IN/
 * FADE_OUT's own feel. */
const FADE_IN = 0.15;
const HOLD = 0.4;
const FADE_OUT = 0.3;

export class SkyDarkenOverlay {
  private readonly g = new Graphics();
  private t = 0;
  private peak = 0;
  private hold = HOLD;

  constructor(width: number, height: number, margin = 20) {
    this.g.rect(-margin, -margin, width + margin * 2, height + margin * 2).fill(0xffffff);
    this.g.alpha = 0;
    this.g.visible = false;
  }

  get view(): Graphics {
    return this.g;
  }

  /** Trigger (or extend, taking the brighter peak / longer hold) the darken
   * beat. `hold` defaults to the brief M7.7 cataclysm pulse; pass a bigger
   * value for a sustained sky event (M7.9 storm/apocalypse). */
  trigger(color: number, peakAlpha = 0.4, hold = HOLD): void {
    this.g.tint = color;
    this.peak = Math.max(this.peak, peakAlpha);
    this.hold = Math.max(this.hold, hold);
    this.t = FADE_IN + this.hold + FADE_OUT;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t = Math.max(0, this.t - dt);
    const total = FADE_IN + this.hold + FADE_OUT;
    const elapsed = total - this.t;
    let frac: number;
    if (elapsed < FADE_IN) {
      frac = safeRadius(elapsed / FADE_IN);
    } else if (elapsed < FADE_IN + this.hold) {
      frac = 1;
    } else {
      frac = safeRadius(1 - (elapsed - FADE_IN - this.hold) / FADE_OUT);
    }
    this.g.alpha = this.peak * frac;
    if (this.t === 0) {
      this.g.visible = false;
      this.peak = 0;
      this.hold = HOLD;
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
