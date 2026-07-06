/**
 * Boss FIELD HAZARD warn overlay (M7.9 "Grand Expansion" render follow-up,
 * map6 s30 Infernal Sovereign — `bossHazardWarn`/`bossHazardStrike`, see
 * `engine/state/events.ts`): a field-wide "danger incoming" read distinct
 * from `skyDarken.ts`'s sky-level ultimate spectacle — a translucent GROUND
 * band + two vertical edge-glow bars, all one shared shape built ONCE
 * (build-once-transform-only, same convention as `arenaFlash.ts`). PULSING
 * (not a flat hold) so the warning stays legible even glanced at mid-pulse-
 * trough on a dim mobile screen; the caller passes the engine's own
 * `CONFIG.bossBehavior.hazard.telegraph` window as `duration` so the visual
 * read resolves right as the first `bossHazardStrike` tick lands. Flat alpha
 * tint only (footgun 10 — never additive over a bright biome sky/ground).
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** Real-seconds fade envelope around the pulsing hold. */
const FADE_IN = 0.12;
const FADE_OUT = 0.25;
/** One pulse cycle length — a handful of throbs across the ~1.3s warn window
 * reads as "building danger", not a static wash. */
const PULSE_PERIOD = 0.35;
/** Fraction of peak alpha the pulse swings by (0 = no pulse, 1 = to zero). */
const PULSE_DEPTH = 0.35;

export class HazardBandOverlay {
  private readonly root = new Container();
  private readonly band = new Graphics();
  private readonly edgeLeft = new Graphics();
  private readonly edgeRight = new Graphics();

  /** Remaining seconds of the current warn window (0 = idle). */
  private t = 0;
  private total = 0;
  private peak = 0;
  /** Free-running pulse clock — reset each fresh `trigger()`. */
  private phase = 0;

  constructor(width: number, height: number, margin = 20) {
    const bandHeight = height * 0.22;
    this.band
      .rect(-margin, height - bandHeight, width + margin * 2, bandHeight + margin)
      .fill(0xffffff);
    const edgeWidth = width * 0.09;
    this.edgeLeft.rect(-margin, -margin, edgeWidth, height + margin * 2).fill(0xffffff);
    this.edgeRight
      .rect(width - edgeWidth, -margin, edgeWidth + margin, height + margin * 2)
      .fill(0xffffff);
    this.root.addChild(this.band, this.edgeLeft, this.edgeRight);
    this.root.alpha = 0;
    this.root.visible = false;
  }

  get view(): Container {
    return this.root;
  }

  /** Trigger (or extend, taking the brighter peak / longer remaining window)
   * the warn pulse. `duration` real seconds. */
  trigger(color: number, peakAlpha: number, duration: number): void {
    this.band.tint = color;
    this.edgeLeft.tint = color;
    this.edgeRight.tint = color;
    this.peak = Math.max(this.peak, peakAlpha);
    this.total = Math.max(this.total, Math.max(0.05, duration));
    this.t = this.total;
    this.phase = 0;
    this.root.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (this.t <= 0) return;
    this.phase += Math.max(0, dt);
    this.t = Math.max(0, this.t - dt);
    const elapsed = this.total - this.t;
    let envelope: number;
    if (elapsed < FADE_IN) {
      envelope = safeRadius(elapsed / FADE_IN);
    } else if (this.t < FADE_OUT) {
      envelope = safeRadius(this.t / FADE_OUT);
    } else {
      envelope = 1;
    }
    const pulse = 1 - PULSE_DEPTH * (0.5 + 0.5 * Math.sin((this.phase / PULSE_PERIOD) * Math.PI * 2));
    this.root.alpha = this.peak * envelope * pulse;
    if (this.t === 0) {
      this.root.visible = false;
      this.peak = 0;
      this.total = 0;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
