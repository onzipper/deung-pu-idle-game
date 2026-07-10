/**
 * Generic pooled "floating text" ring buffer — rises + fades over its
 * lifetime. Backs both damage numbers and the smaller "event text" pool (kill
 * gold, boss gold, labels) so neither allocates a Pixi `Text` per occurrence:
 * every slot is a pre-created `Text` reused round-robin, capped at `cap`
 * concurrent labels (spawning past the cap evicts the oldest, per the spec).
 * Each `Text` gets a black `TextStyle.stroke` set once at construction (never
 * touched per-spawn) so labels stay readable against bright biomes.
 */

import { Container, Text } from "pixi.js";

interface FloatingTextSlot {
  text: Text;
  active: boolean;
  age: number;
  duration: number;
  x0: number;
  y0: number;
  rise: number;
  driftX: number;
}

export interface SpawnTextOptions {
  x: number;
  y: number;
  label: string;
  color: number;
  fontSize: number;
  /** Total seconds to live (rise + fade). */
  duration?: number;
  /** Total upward travel in px over `duration`. */
  rise?: number;
  /** Small horizontal drift over `duration`, for de-stacking simultaneous hits. */
  driftX?: number;
  bold?: boolean;
}

export class FloatingTextPool {
  private readonly slots: FloatingTextSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const text = new Text({
        text: "",
        style: {
          fontSize: 14,
          fontWeight: "700",
          fill: 0xffffff,
          fontFamily: "monospace",
          stroke: { color: 0x000000, width: 3 },
        },
      });
      text.anchor.set(0.5);
      text.visible = false;
      container.addChild(text);
      return {
        text,
        active: false,
        age: 0,
        duration: 0.6,
        x0: 0,
        y0: 0,
        rise: 26,
        driftX: 0,
      };
    });
  }

  spawn(opts: SpawnTextOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.1, opts.duration ?? 0.6);
    slot.x0 = opts.x;
    slot.y0 = opts.y;
    slot.rise = opts.rise ?? 26;
    slot.driftX = opts.driftX ?? (Math.random() - 0.5) * 10;

    slot.text.text = opts.label;
    slot.text.style.fontSize = opts.fontSize;
    slot.text.style.fill = opts.color;
    slot.text.style.fontWeight = opts.bold === false ? "600" : "800";
    slot.text.alpha = 1;
    slot.text.visible = true;
    slot.text.position.set(slot.x0, slot.y0);
  }

  /** Advance every live label by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.duration) {
        slot.active = false;
        slot.text.visible = false;
        continue;
      }
      const frac = slot.age / slot.duration;
      // Ease-out rise: fast at first, settling near the top.
      const eased = 1 - (1 - frac) * (1 - frac);
      slot.text.position.set(
        slot.x0 + slot.driftX * frac,
        slot.y0 - slot.rise * eased,
      );
      // Hold full opacity briefly, then fade over the back half of the life.
      slot.text.alpha = frac < 0.35 ? 1 : 1 - (frac - 0.35) / 0.65;
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      this.container.removeChild(slot.text);
      slot.text.destroy();
    }
    this.slots.length = 0;
  }
}
