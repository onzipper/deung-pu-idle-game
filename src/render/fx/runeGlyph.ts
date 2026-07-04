/**
 * Pooled rotating rune-circle glyph — a stroked double ring + a handful of
 * tick marks, built ONCE per spawn (only rotation/alpha change per frame
 * afterward — build-once, transform-only). Two HERO SIGNATURE PASS call
 * sites share this: the mage's small cast glyph on every orb release
 * (item 10) and the meteor skill's large ground rune while it falls (item 11).
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** Small pool — at most a cast glyph or two plus one meteor rune concurrently. */
const DEFAULT_CAP = 4;

interface RuneSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  rotationSpeed: number;
  fadeInFrac: number;
  peakAlpha: number;
}

export interface SpawnRuneOptions {
  x: number;
  y: number;
  radius: number;
  ticks?: number;
  color: number;
  /** Real seconds this glyph stays alive. */
  life: number;
  rotationSpeed?: number;
  alpha?: number;
  /** Fraction of `life` spent easing alpha IN at the start (0 = instant-on). */
  fadeInFrac?: number;
}

export class RuneGlyphPool {
  private readonly slots: RuneSlot[];
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
        age: 0,
        life: 0.3,
        rotationSpeed: 2,
        fadeInFrac: 0,
        peakAlpha: 0.55,
      };
    });
  }

  spawn(opts: SpawnRuneOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life);
    slot.rotationSpeed = opts.rotationSpeed ?? 2.2;
    slot.fadeInFrac = Math.max(0, Math.min(0.9, opts.fadeInFrac ?? 0));
    slot.peakAlpha = opts.alpha ?? 0.55;
    slot.g.visible = true;
    slot.g.position.set(opts.x, opts.y);
    slot.g.rotation = 0;
    slot.g.alpha = slot.fadeInFrac > 0 ? 0 : slot.peakAlpha;
    drawGlyphShape(slot.g, safeRadius(opts.radius), opts.ticks ?? 8, opts.color);
  }

  /** Advance every live glyph by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      slot.g.rotation += slot.rotationSpeed * dt;

      const frac = slot.age / slot.life;
      const fadeIn = slot.fadeInFrac > 0 ? Math.min(1, frac / slot.fadeInFrac) : 1;
      const fadeOut = 1 - Math.max(0, (frac - 0.65) / 0.35); // ease out over the last 35%
      slot.g.alpha = slot.peakAlpha * Math.min(fadeIn, Math.max(0, fadeOut));
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

/** Build the ring + tick marks ONCE — only transform/alpha change afterward. */
function drawGlyphShape(g: Graphics, radius: number, ticks: number, color: number): void {
  g.clear();
  g.circle(0, 0, radius).stroke({ width: Math.max(1, radius * 0.06), color, alpha: 1 });
  g.circle(0, 0, safeRadius(radius * 0.7)).stroke({
    width: Math.max(1, radius * 0.04),
    color,
    alpha: 0.7,
  });
  for (let i = 0; i < ticks; i++) {
    const a = (Math.PI * 2 * i) / ticks;
    const r0 = radius * 0.78;
    const r1 = radius * 0.95;
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      .lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
      .stroke({ width: Math.max(1, radius * 0.05), color, alpha: 1 });
  }
}
