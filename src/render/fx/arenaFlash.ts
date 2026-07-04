/**
 * Full-arena flash overlay — a single reusable full-bleed `Graphics` rect
 * whose alpha spikes then decays. Used for boss-enrage, boss-defeated, and
 * stage-advanced beats. Deliberately ONE shared shape (not a pool): at most
 * one of these reads are meaningfully visible at a time, and retriggering
 * while still fading just takes the brighter of the two (never stacks into a
 * strobe — the task explicitly calls out "no epilepsy strobes").
 */

import { Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** Seconds the flash takes to fully fade back to invisible. */
const FLASH_DURATION = 0.45;

export class ArenaFlash {
  private readonly g = new Graphics();
  private t = 0;
  private color = 0xffffff;
  private peak = 0;

  constructor(width: number, height: number, margin = 20) {
    this.g
      .rect(-margin, -margin, width + margin * 2, height + margin * 2)
      .fill(0xffffff);
    this.g.alpha = 0;
    this.g.visible = false;
  }

  get view(): Graphics {
    return this.g;
  }

  /** Trigger (or brighten) the flash. `peakAlpha` in [0,1], subtle by design. */
  trigger(color: number, peakAlpha: number): void {
    this.color = color;
    this.peak = Math.max(this.peak, peakAlpha);
    this.t = FLASH_DURATION;
    this.g.tint = this.color;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t = Math.max(0, this.t - dt);
    const frac = safeRadius(this.t / FLASH_DURATION);
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
