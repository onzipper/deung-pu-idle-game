/**
 * Armor-shard pool — 2-3 jagged plate-chip polygons arcing outward (and
 * falling) on a TANK death (DEATH & SPAWN DRAMA, 86d3k2qjk item 1) — heavier
 * debris than the shared kill-pop particle burst, reserved for the one enemy
 * kind that's visually "armored". Capped small: at most a couple of tank
 * deaths are ever realistically concurrent even at 3x speed.
 *
 * Same build-once-then-transform-only convention as `crescent.ts`'s shard
 * mode: the quad poly is drawn once per spawn in local space; every frame
 * after that only updates position/rotation/alpha (gravity-driven arc).
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DEFAULT_CAP = 8;
/** Downward acceleration, px/s^2 — these are heavy metal chips, they fall. */
const GRAVITY = 260;

interface ShardSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotationSpeed: number;
  startAlpha: number;
}

export interface SpawnShardOptions {
  x: number;
  y: number;
  /** Launch direction, radians. */
  angle: number;
  speed?: number;
  color: number;
  w?: number;
  h?: number;
  life?: number;
}

export class ArmorShardPool {
  private readonly slots: ShardSlot[];
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
        life: 0.5,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rotationSpeed: 0,
        startAlpha: 0.9,
      };
    });
  }

  spawn(opts: SpawnShardOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    const speed = opts.speed ?? 110;
    const w = safeRadius(opts.w ?? 7);
    const h = safeRadius(opts.h ?? 5);

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.1, opts.life ?? 0.5);
    slot.x = opts.x;
    slot.y = opts.y;
    slot.vx = Math.cos(opts.angle) * speed;
    slot.vy = Math.sin(opts.angle) * speed;
    slot.rotationSpeed = (Math.random() - 0.5) * 10;
    slot.startAlpha = 0.9;

    slot.g.visible = true;
    slot.g.alpha = slot.startAlpha;
    slot.g.rotation = opts.angle;
    slot.g.position.set(slot.x, slot.y);
    slot.g.clear();
    // Small irregular quad — reads as a broken plate chip, not a clean rect.
    slot.g
      .poly([-w / 2, -h / 2, w / 2, -h * 0.35, w * 0.3, h / 2, -w / 2, h * 0.3], true)
      .fill({ color: opts.color, alpha: 1 });
  }

  /** Advance every live shard by `dt` real seconds. */
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
      slot.vy += GRAVITY * dt;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;
      slot.g.rotation += slot.rotationSpeed * dt;
      slot.g.position.set(slot.x, slot.y);
      slot.g.alpha = slot.startAlpha * (1 - frac);
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
