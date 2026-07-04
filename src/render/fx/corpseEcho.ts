/**
 * Corpse echo — a brief render-side "collapse" for regular enemies.
 *
 * The engine removes a dead enemy from `state.enemies` the SAME step it
 * dies, so `enemyView.ts`'s pooled view is destroyed before any death anim
 * could play on it. Rather than trying to keep the entity alive render-side,
 * this is a small, capped, fixed-size pool of pre-created `Graphics` blobs
 * (same ring-buffer pattern as `particles.ts`/`rings.ts`) spawned off the
 * `kill` event: a quick flattening/fading silhouette at the death position,
 * tinted by the kind's color. Deliberately subtle — the kill-pop burst
 * already covers the "impact."
 */

import { Container, Graphics } from "pixi.js";
import type { EnemyKind } from "@/engine/entities";
import { ENEMY_COLORS, safeRadius } from "@/render/theme";

interface CorpseSlot {
  g: Graphics;
  active: boolean;
  age: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

/** Real seconds the crumple takes to fully flatten + fade. */
const DURATION = 0.25;
/** Capped by design — a handful of concurrent corpse echoes is plenty. */
const DEFAULT_CAP = 12;

export class CorpseEchoPool {
  private readonly slots: CorpseSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, x: 0, y: 0, w: 0, h: 0, color: 0xffffff };
    });
  }

  spawn(x: number, y: number, kind: EnemyKind, size: number): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    const s = Math.max(0.3, size);
    slot.active = true;
    slot.age = 0;
    slot.x = x;
    slot.y = y;
    slot.w = 22 * s;
    slot.h = 16 * s;
    slot.color = ENEMY_COLORS[kind];
    slot.g.visible = true;
  }

  /** Advance every live echo by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= DURATION) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      const frac = slot.age / DURATION;
      const scaleY = Math.max(0.05, 1 - frac);
      const scaleX = 1 + frac * 0.35;
      const alpha = (1 - frac) * 0.7;
      const w = safeRadius(slot.w * scaleX);
      const h = safeRadius(slot.h * scaleY);

      slot.g.clear();
      slot.g.roundRect(slot.x - w / 2, slot.y - h, w, h, 3).fill({ color: slot.color, alpha });
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
