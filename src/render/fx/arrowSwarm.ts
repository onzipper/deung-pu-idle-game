/**
 * Archer STORM's arrow-swarm silhouette band (M7.9 "Grand Expansion" tier-3
 * skill-4, "archer_storm") — a pooled cluster of small dark angled streak
 * marks reading as a distant swarm of arrows/thunderheads silhouetted
 * against the sky, sweeping in left-to-right across the top of the arena and
 * drifting slowly for the whole ~4s storm. Held ALONGSIDE
 * `fx/skyDarken.ts`'s green-tinted sky overlay (both triggered from
 * `FxController.onArcherStormCast()`) — this is the "swarm" half of that sky
 * event, the overlay is the "darken" half.
 *
 * Flat alpha only (footgun 10: never additive over the bright daytime biome
 * sky) — each shape is a few short `stroke()` dashes, built ONCE per spawn;
 * `update()` only drifts position + eases alpha (build-once-then-transform,
 * same convention as every other pool in this directory).
 */

import { Container, Graphics } from "pixi.js";

/** A handful of concurrent swarm clusters is plenty — mobile-friendly, cheap
 * (4 short strokes per shape). */
const DEFAULT_CAP = 12;
/** Slow, constant real-time drift (px/sec) — reads as a storm cloud/swarm
 * passing overhead, not a hail (that's the falling rain-arrow curtain's job). */
const DEFAULT_DRIFT_X = 22;
/** Fraction of life spent easing alpha in at the start. */
const FADE_IN_FRAC = 0.18;
/** Fraction of life elapsed before easing alpha back out. */
const FADE_OUT_START_FRAC = 0.72;
const PEAK_ALPHA = 0.5;

interface SwarmSlot {
  g: Graphics;
  /** `active` once its `delay` has drained and it's actually visible/aging;
   * `waiting` while still counting down that initial stagger delay. */
  active: boolean;
  waiting: boolean;
  age: number;
  life: number;
  delay: number;
  driftX: number;
}

export interface SpawnSwarmOptions {
  x: number;
  y: number;
  color: number;
  /** Real seconds this cluster stays alive — pass the storm's own sustained
   * duration so the band reads as part of the same beat, not a one-shot. */
  life: number;
  driftX?: number;
  /** Real-seconds delay before this cluster fades in (staggers a whole band
   * so it reads as one swarm SWEEPING in, not popping in all at once). */
  delay?: number;
}

export class ArrowSwarmPool {
  private readonly slots: SwarmSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return {
        g,
        active: false,
        waiting: false,
        age: 0,
        life: 1,
        delay: 0,
        driftX: DEFAULT_DRIFT_X,
      };
    });
  }

  /** Build a small jagged cluster of angled dashes ONCE — only position/alpha
   * change per frame afterward (no per-frame path rebuilding). */
  private drawShape(g: Graphics, color: number): void {
    g.clear();
    for (let i = 0; i < 4; i++) {
      const ox = i * 7 - 10;
      const oy = (i % 2) * 3 - 1;
      g.moveTo(ox, oy)
        .lineTo(ox + 11, oy - 3.5)
        .stroke({ width: 2, color, alpha: 0.9, cap: "round" });
    }
  }

  /** Spawn one cluster (used directly, or via `spawnBand()` below). */
  spawn(opts: SpawnSwarmOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.delay = Math.max(0, opts.delay ?? 0);
    slot.waiting = slot.delay > 0;
    slot.active = !slot.waiting;
    slot.age = 0;
    slot.life = Math.max(0.2, opts.life);
    slot.driftX = opts.driftX ?? DEFAULT_DRIFT_X;
    slot.g.visible = slot.active;
    slot.g.alpha = 0;
    slot.g.position.set(opts.x, opts.y);
    this.drawShape(slot.g, opts.color);
  }

  /** Convenience: spawn `count` clusters spread across a band centered on
   * `centerX`, staggered by SPATIAL INDEX so the whole band reads as
   * sweeping in left-to-right (same staggering trick `curtainSweep.ts`'s
   * `spawnField()` uses). */
  spawnBand(centerX: number, count: number, y: number, color: number, life: number): void {
    const span = 700;
    const n = Math.max(1, count - 1);
    for (let i = 0; i < count; i++) {
      const x = centerX - span / 2 + (span * i) / n;
      this.spawn({ x, y, color, life, delay: (i / n) * 0.7 });
    }
  }

  /** Advance every slot by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active && !slot.waiting) continue;
      if (slot.waiting) {
        slot.delay -= dt;
        if (slot.delay <= 0) {
          slot.waiting = false;
          slot.active = true;
          slot.g.visible = true;
          slot.age = 0;
        }
        continue;
      }
      slot.age += dt;
      slot.g.position.x += slot.driftX * dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      const frac = slot.age / slot.life;
      const fadeIn = Math.min(1, frac / FADE_IN_FRAC);
      const fadeOut = 1 - Math.max(0, (frac - FADE_OUT_START_FRAC) / (1 - FADE_OUT_START_FRAC));
      slot.g.alpha = PEAK_ALPHA * Math.min(fadeIn, Math.max(0, fadeOut));
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      this.container.removeChild(slot.g);
      slot.g.destroy();
    }
    this.slots.length = 0;
  }
}
