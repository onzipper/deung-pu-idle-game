/**
 * Manual play (M7.8 "Manual Play") command feedback — RO-style tap-to-move /
 * tap-to-attack juice, entirely render-side (the engine only exposes the
 * `moveOrdered`/`targetLocked`/`commandCancelled` events + the live
 * `hero.command` field; it never knows this module exists).
 *
 * - Ground click-marker (`moveOrdered`): a handful of pooled concentric
 *   fading rings at the clamped x — reuses the shared `RingPool` directly
 *   from `FxController` (a one-shot transient effect needs no dedicated pool
 *   here, see `onMoveOrdered()`).
 * - Target-lock reticle (`targetLocked`, PERSISTS while
 *   `hero.command.kind === "attack"`): the one piece of new state in this
 *   file — a CONTINUOUS per-frame read (same convention as
 *   `gearAura.ts`/`castAura.ts`, not event-driven), built ONCE; only
 *   position/rotation/alpha change per frame. Eases its own alpha toward 0
 *   when there's no active attack command instead of snapping invisible, so
 *   `commandCancelled` (and a command simply completing) reads as a quick
 *   fade rather than a hard cut.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const RETICLE_RADIUS = 15;
const RETICLE_TICK_LEN = 6;
const ROTATE_SPEED = 0.6; // rad/s — slow, calm "locked on" spin, never dizzying
const FADE_RATE = 10; // per-second ease toward the on/off alpha target

/** A world-space point to lock the reticle onto, or `null` while inactive. */
export interface ReticleTarget {
  x: number;
  y: number;
}

export class TargetLockReticle {
  private readonly g: Graphics;
  private alpha = 0;
  private spin = 0;

  constructor(layer: Container) {
    this.g = new Graphics();
    this.g.visible = false;
    this.buildShape();
    layer.addChild(this.g);
  }

  /** Built ONCE — a plain reticle vocabulary (double ring + 4 corner ticks),
   * distinct from HP bars / event rings, so a lock reads unmistakably as
   * "your command", not combat juice. */
  private buildShape(): void {
    const r = safeRadius(RETICLE_RADIUS);
    const g = this.g;
    g.clear();
    g.circle(0, 0, r).stroke({ width: 1.6, color: PALETTE.orderAttackDark, alpha: 0.9 });
    g.circle(0, 0, r).stroke({ width: 1, color: PALETTE.orderAttack, alpha: 0.95 });
    const ticks = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
    for (const a of ticks) {
      const x0 = Math.cos(a) * (r - RETICLE_TICK_LEN);
      const y0 = Math.sin(a) * (r - RETICLE_TICK_LEN);
      const x1 = Math.cos(a) * (r + 2);
      const y1 = Math.sin(a) * (r + 2);
      g.moveTo(x0, y0)
        .lineTo(x1, y1)
        .stroke({ width: 2, color: PALETTE.orderAttack, alpha: 0.95 });
    }
  }

  /** Call every frame with the CURRENT lock target (or `null`), real `dt`. */
  update(dt: number, target: ReticleTarget | null): void {
    const targetAlpha = target ? 1 : 0;
    this.alpha += (targetAlpha - this.alpha) * Math.min(1, Math.max(0, dt) * FADE_RATE);
    this.spin += dt * ROTATE_SPEED;
    if (this.alpha < 0.01 && !target) {
      this.g.visible = false;
      return;
    }
    this.g.visible = true;
    this.g.alpha = Math.max(0, Math.min(1, this.alpha));
    this.g.rotation = this.spin;
    // Freeze at the last known position while fading OUT (target already
    // null) so the reticle doesn't jump before it finishes disappearing.
    if (target) this.g.position.set(target.x, target.y);
  }

  destroy(): void {
    this.g.destroy();
  }
}
