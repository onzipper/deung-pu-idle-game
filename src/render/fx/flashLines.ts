/**
 * Pooled quick directional line flashes — used by the archer skill's
 * "fan of light toward each target" beat (HERO SIGNATURE PASS item 9). A
 * generic small pool (not archer-specific) in case future juice wants the
 * same "streak from A toward B" primitive.
 */

import { Container, Graphics } from "pixi.js";

/** Spec knob: a small handful of concurrent flashes is plenty. */
const DEFAULT_CAP = 8;
const DEFAULT_LIFE = 0.14;

interface FlashLineSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
}

export interface SpawnFlashLineOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  width?: number;
  life?: number;
  alpha?: number;
}

export class FlashLinePool {
  private readonly slots: FlashLineSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, life: DEFAULT_LIFE };
    });
  }

  spawn(opts: SpawnFlashLineOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.03, opts.life ?? DEFAULT_LIFE);
    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.clear();
    slot.g
      .moveTo(opts.x1, opts.y1)
      .lineTo(opts.x2, opts.y2)
      .stroke({
        width: opts.width ?? 1.6,
        color: opts.color,
        alpha: opts.alpha ?? 0.7,
        cap: "round",
      });
  }

  /** Advance every live flash by `dt` real seconds. */
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
      slot.g.alpha = 1 - slot.age / slot.life;
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
