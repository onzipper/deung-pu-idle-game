/**
 * Pooled expanding-ring effect: a stroked circle that grows from a small
 * radius out to `maxRadius` while fading, used for the swordsman spin-skill
 * cast, the boss-telegraph "intensify" pulse, and the boss-defeated shockwave.
 *
 * This is exactly the effect class the POC's negative-radius crash came from
 * (`shockwave()` rings outliving their `dur`), so every radius here is run
 * through `safeRadius()` before it ever reaches a Pixi `Graphics` call.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

interface RingSlot {
  g: Graphics;
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  r0: number;
  r1: number;
  width: number;
  color: number;
}

export interface SpawnRingOptions {
  x: number;
  y: number;
  /** Starting radius (usually small/near-zero). */
  r0?: number;
  /** Radius the ring expands to by the end of its life. */
  r1: number;
  duration?: number;
  width?: number;
  color: number;
}

const DEFAULT_CAP = 12;

export class RingPool {
  private readonly slots: RingSlot[];
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
        duration: 0.35,
        x: 0,
        y: 0,
        r0: 0,
        r1: 0,
        width: 3,
        color: 0xffffff,
      };
    });
  }

  spawn(opts: SpawnRingOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.05, opts.duration ?? 0.35);
    slot.x = opts.x;
    slot.y = opts.y;
    slot.r0 = safeRadius(opts.r0 ?? 4);
    slot.r1 = safeRadius(opts.r1);
    slot.width = opts.width ?? 3;
    slot.color = opts.color;
    slot.g.visible = true;
    slot.g.position.set(slot.x, slot.y);
  }

  /** Advance every live ring by `dt` real seconds. */
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
      const r = safeRadius(slot.r0 + (slot.r1 - slot.r0) * frac);
      const alpha = 1 - frac;
      slot.g.clear();
      slot.g
        .circle(0, 0, r)
        .stroke({ width: slot.width, color: slot.color, alpha });
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
