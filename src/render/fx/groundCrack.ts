/**
 * Pooled ground-crack decal — the swordsman's signature-tier "ground cracks"
 * beat (M7.7 "Skill Spectacle"): a handful of jagged spokes radiating out
 * from an impact point along the ground, a dark scorched fill/outline first
 * then a thinner molten-glow stroke on top (footgun 10: solid flat colors on
 * NORMAL blend + a darker underlayer, never additive). Used by the whirl
 * signature (small, tight cracks at the feet) and the quake ultimate (big,
 * field-reaching cracks) — same pool, different `radius`/`spokes`.
 *
 * Build-once-then-fade convention: the jagged spoke geometry is randomized
 * but drawn ONCE per spawn; `update()` only eases alpha back to 0 afterward
 * (no per-frame path rebuilding).
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** A few small whirl-cracks + at most one big quake crack concurrently. */
const DEFAULT_CAP = 8;
/** Spokes per crack — kept low; this reads as "a few jagged fissures", not a
 * dense starburst. */
const DEFAULT_SPOKES = 6;
/** Fraction of life spent fully visible before easing out. */
const HOLD_FRAC = 0.35;

interface CrackSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  peakAlpha: number;
}

export interface SpawnCrackOptions {
  x: number;
  y: number;
  radius: number;
  spokes?: number;
  /** Real seconds this crack decal stays visible before fading fully out. */
  life?: number;
  darkColor: number;
  glowColor: number;
  alpha?: number;
}

export class GroundCrackPool {
  private readonly slots: CrackSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, life: 0.5, peakAlpha: 0.8 };
    });
  }

  spawn(opts: SpawnCrackOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.1, opts.life ?? 0.5);
    slot.peakAlpha = opts.alpha ?? 0.8;
    slot.g.visible = true;
    slot.g.alpha = slot.peakAlpha;
    slot.g.position.set(opts.x, opts.y);
    drawCrackShape(
      slot.g,
      safeRadius(opts.radius),
      Math.max(3, opts.spokes ?? DEFAULT_SPOKES),
      opts.darkColor,
      opts.glowColor,
    );
  }

  /** Advance every live crack by `dt` real seconds. */
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
      const frac = slot.age / slot.life;
      const fadeOut = frac < HOLD_FRAC ? 1 : 1 - (frac - HOLD_FRAC) / (1 - HOLD_FRAC);
      slot.g.alpha = slot.peakAlpha * Math.max(0, fadeOut);
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

/** Build the jagged radiating spokes ONCE — only alpha changes per frame
 * afterward. Each spoke is a 3-point jagged line (never `Graphics.arc()` —
 * this uses plain `moveTo`/`lineTo`, so the arc-collapse footgun doesn't
 * apply here at all). Dark underlayer stroke first (thicker), a thinner
 * molten-glow stroke on top — flat colors, NORMAL blend, no gradients. */
function drawCrackShape(
  g: Graphics,
  radius: number,
  spokes: number,
  darkColor: number,
  glowColor: number,
): void {
  g.clear();
  for (let i = 0; i < spokes; i++) {
    const angle = (Math.PI * 2 * i) / spokes + (Math.random() - 0.5) * 0.5;
    const len = radius * (0.55 + Math.random() * 0.45);
    const midR = len * (0.45 + Math.random() * 0.2);
    const jitter = (Math.random() - 0.5) * len * 0.25;
    const perp = angle + Math.PI / 2;
    const midX = Math.cos(angle) * midR + Math.cos(perp) * jitter;
    const midY = Math.sin(angle) * midR + Math.sin(perp) * jitter;
    const endX = Math.cos(angle) * len;
    const endY = Math.sin(angle) * len;

    g.moveTo(0, 0)
      .lineTo(midX, midY)
      .lineTo(endX, endY)
      .stroke({ width: Math.max(2, radius * 0.05), color: darkColor, alpha: 1, cap: "round" });
    g.moveTo(0, 0)
      .lineTo(midX, midY)
      .lineTo(endX, endY)
      .stroke({ width: Math.max(1, radius * 0.022), color: glowColor, alpha: 0.85, cap: "round" });
  }
}
