/**
 * Orbiting sparkle aura around the mage during `castHold` (HERO SIGNATURE
 * PASS item 12) — a small fixed ring of dots orbiting a continuously-updated
 * center (the mage's live x/y), driven by ONE shared phase clock so they
 * read as a cohesive halo rather than independent particles. Continuous /
 * state-driven (like `weaponTrail.ts`), not event-driven: `castHold` spans
 * many frames with no discrete per-frame event of its own.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DOT_COUNT = 5;
const ORBIT_RADIUS = 18;
/** Vertical squash so the orbit reads as a halo around the torso, not a flat
 * circle floating in front of it. */
const ORBIT_Y_SQUASH = 0.55;
const ORBIT_SPEED = 5.2; // radians/sec
const DOT_RADIUS = 1.6;
/** Per-second lerp rate for the in/out alpha fade (smooths the on/off edges
 * of `castHold` instead of a hard pop). */
const FADE_RATE = 7;

export interface CastAuraCenter {
  x: number;
  y: number;
  color: number;
}

export class CastAuraController {
  private readonly dots: Graphics[];
  private phase = 0;
  private alpha = 0;

  constructor(private readonly container: Container) {
    this.dots = Array.from({ length: DOT_COUNT }, () => {
      const g = new Graphics();
      g.circle(0, 0, safeRadius(DOT_RADIUS)).fill(0xffffff);
      g.visible = false;
      container.addChild(g);
      return g;
    });
  }

  /** `center` is null while no mage is actively holding a cast this frame. */
  update(dt: number, center: CastAuraCenter | null): void {
    const targetAlpha = center ? 0.85 : 0;
    this.alpha += (targetAlpha - this.alpha) * Math.min(1, dt * FADE_RATE);
    this.phase += dt * ORBIT_SPEED;

    const visible = this.alpha > 0.02;
    for (let i = 0; i < this.dots.length; i++) {
      const dot = this.dots[i];
      dot.visible = visible;
      if (!visible || !center) continue;
      const a = this.phase + (i / this.dots.length) * Math.PI * 2;
      dot.position.set(
        center.x + Math.cos(a) * ORBIT_RADIUS,
        center.y + Math.sin(a) * ORBIT_RADIUS * ORBIT_Y_SQUASH,
      );
      dot.tint = center.color;
      dot.alpha = this.alpha;
    }
  }

  destroy(): void {
    for (const dot of this.dots) {
      this.container.removeChild(dot);
      dot.destroy();
    }
    this.dots.length = 0;
  }
}
