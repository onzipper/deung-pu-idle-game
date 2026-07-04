/**
 * Light-pillar pool — the "beam from above" beat for hero revive v2 (DEATH &
 * SPAWN DRAMA, 86d3k2qjk item 4): a tall, narrow, multi-layer-alpha beam that
 * grows downward from above the hero's head to the ground, holds briefly,
 * then fades — alongside the existing spring-bounce revive anim in
 * `heroView.ts` (untouched) and the radial sparkle burst + brief hit-flash
 * pulse `FxController.onHeroRevived()` triggers directly.
 *
 * Anchored (pivot/position) at its OWN top so animating `scale.y` from ~0 up
 * to 1 makes it read as "descending onto the body", not "growing out of the
 * ground". Built once per spawn (3 nested flat-alpha rects — wide+faint
 * outer glow to a narrow+bright core, no gradients); every frame after that
 * only touches `scale`/`alpha`.
 *
 * Capped tiny (at most 3 heroes ever revive at once) — a small pool here is
 * purely a safety margin, not a real contention concern like the enemy-side
 * pools.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DEFAULT_CAP = 4;
/** Fraction of `duration` spent growing downward before holding. */
const GROW_FRAC = 0.35;
/** Fraction of `duration` spent fading out at the end. */
const FADE_FRAC = 0.35;

interface PillarSlot {
  g: Graphics;
  active: boolean;
  age: number;
  duration: number;
}

export interface SpawnPillarOptions {
  x: number;
  /** World-space y of the beam's top (above the head). */
  topY: number;
  /** Total beam height, top to ground. */
  height: number;
  color: number;
  duration?: number;
  width?: number;
}

export class LightPillarPool {
  private readonly slots: PillarSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, duration: 0.35 };
    });
  }

  spawn(opts: SpawnPillarOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    const w = safeRadius(opts.width ?? 14);
    const h = safeRadius(opts.height);

    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.1, opts.duration ?? 0.35);

    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.position.set(opts.x, opts.topY);
    slot.g.scale.set(1, 0.0001);
    slot.g.clear();
    // Nested flat-alpha rects — wide+faint outer glow to a narrow+bright core.
    slot.g.rect(-w / 2, 0, w, h).fill({ color: opts.color, alpha: 0.16 });
    slot.g.rect(-w * 0.32, 0, w * 0.64, h).fill({ color: opts.color, alpha: 0.3 });
    slot.g.rect(-w * 0.12, 0, w * 0.24, h).fill({ color: 0xffffff, alpha: 0.55 });
  }

  /** Advance every live pillar by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.duration) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      const frac = slot.age / slot.duration;
      const scaleY =
        frac < GROW_FRAC ? Math.max(0.0001, frac / GROW_FRAC) : 1;
      const fadeStart = 1 - FADE_FRAC;
      const alpha = frac > fadeStart ? Math.max(0, 1 - (frac - fadeStart) / FADE_FRAC) : 1;
      slot.g.scale.set(1, scaleY);
      slot.g.alpha = alpha;
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
