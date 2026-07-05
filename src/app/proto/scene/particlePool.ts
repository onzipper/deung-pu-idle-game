/**
 * Tiny self-contained pooled particle system for the M6.5 art-direction
 * prototype — same "fixed-size ring buffer of pre-built Graphics dots, never
 * allocate per-frame" pattern as `src/render/fx/particles.ts`, reimplemented
 * locally because this route may not import anything from `src/render`.
 *
 * Every radius is run through `safeRadius()` (POC negative-radius crash rule).
 * Shared by hit sparks + all three aura tiers, capped low (~80 total across
 * the whole page) so it stays smooth on a mid phone.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "./palette";

interface Slot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  r0: number;
  color: number;
  startAlpha: number;
  /** 0 = circle dot, 1 = thin upward "tongue"/teardrop shape (flame tier). */
  shape: 0 | 1;
}

export interface SpawnOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  radius: number;
  color: number;
  gravity?: number;
  drag?: number;
  alpha?: number;
  shape?: 0 | 1;
}

export class ParticlePool {
  private readonly slots: Slot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return {
        g,
        active: false,
        age: 0,
        life: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gravity: 0,
        drag: 1,
        r0: 0,
        color: 0xffffff,
        startAlpha: 1,
        shape: 0 as const,
      };
    });
  }

  spawn(opts: SpawnOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life);
    slot.x = opts.x;
    slot.y = opts.y;
    slot.vx = opts.vx;
    slot.vy = opts.vy;
    slot.gravity = opts.gravity ?? 0;
    slot.drag = opts.drag ?? 1;
    slot.r0 = safeRadius(opts.radius);
    slot.color = opts.color;
    slot.startAlpha = opts.alpha ?? 1;
    slot.shape = opts.shape ?? 0;
    slot.g.visible = true;
  }

  /** Advance every live particle by `dt` real seconds (never sub-step count —
   * this whole prototype is wall-clock driven). */
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
      slot.vy += slot.gravity * dt;
      const dampen = Math.pow(slot.drag, dt);
      slot.vx *= dampen;
      slot.vy *= dampen;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;

      const alpha = slot.startAlpha * (1 - frac);
      const r = safeRadius(slot.r0 * (1 - frac * 0.5));

      slot.g.position.set(slot.x, slot.y);
      slot.g.clear();
      if (slot.shape === 1) {
        // Flat-alpha "flame tongue": a narrow triangle stretched opposite its
        // rise direction — no gradients, just a solid fill fading with age.
        const h = r * 3.2;
        slot.g
          .poly([0, -h, r * 0.6, 0, -r * 0.6, 0])
          .fill({ color: slot.color, alpha });
      } else {
        slot.g.circle(0, 0, r).fill({ color: slot.color, alpha });
      }
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

/** Small omnidirectional burst — hit sparks / kill pops. */
export function burst(
  pool: ParticlePool,
  x: number,
  y: number,
  count: number,
  color: number,
  opts?: { speed?: number; life?: number; radius?: number; gravity?: number; drag?: number },
): void {
  const speed = opts?.speed ?? 90;
  const life = opts?.life ?? 0.3;
  const radius = opts?.radius ?? 2.5;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const s = speed * (0.6 + Math.random() * 0.6);
    pool.spawn({
      x,
      y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      life: life * (0.7 + Math.random() * 0.6),
      radius: radius * (0.7 + Math.random() * 0.6),
      color,
      gravity: opts?.gravity ?? 0,
      drag: opts?.drag ?? 0.08,
    });
  }
}
