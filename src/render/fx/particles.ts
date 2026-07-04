/**
 * Generic pooled "burst" particle system shared by kill pops, meteor impacts,
 * boss-defeated bursts, gold showers, and spawn poofs — a single bounded pool
 * instead of one ad-hoc particle system per effect.
 *
 * Fixed-size ring buffer of pre-created `Graphics` dots (never allocate a Pixi
 * display object per-frame/per-hit): `spawn()` claims the next ring slot
 * (evicting whatever was there, oldest-first) and `update(dt)` advances every
 * live particle by real elapsed seconds — so 3x game speed never speeds up the
 * burst's visual lifetime.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

interface ParticleSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Downward acceleration in px/s^2 (0 = no gravity, e.g. spark/pop dots). */
  gravity: number;
  /** Multiplicative velocity damping per second (1 = no drag). */
  drag: number;
  r0: number;
  color: number;
  startAlpha: number;
}

export interface SpawnParticleOptions {
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
}

/** Total concurrent burst particles across every effect that shares this pool. */
const DEFAULT_CAP = 220;

export class ParticlePool {
  private readonly slots: ParticleSlot[];
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
      };
    });
  }

  spawn(opts: SpawnParticleOptions): void {
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
    slot.g.visible = true;
    slot.g.position.set(slot.x, slot.y);
  }

  /** Advance every live particle by `dt` real seconds. */
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
      // `drag` is the fraction of velocity retained after one real second;
      // raising it to `dt` keeps the damping rate independent of frame rate.
      const dampen = Math.pow(slot.drag, dt);
      slot.vx *= dampen;
      slot.vy *= dampen;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;

      const r = safeRadius(slot.r0 * (1 - frac * 0.6));
      const alpha = slot.startAlpha * (1 - frac);

      slot.g.position.set(slot.x, slot.y);
      slot.g.clear();
      slot.g.circle(0, 0, r).fill({ color: slot.color, alpha });
    }
  }

  /** Full teardown (renderer destroy). */
  destroy(): void {
    for (const slot of this.slots) {
      this.container.removeChild(slot.g);
      slot.g.destroy();
    }
    this.slots.length = 0;
  }
}

/** A small circular burst (kill pops, impacts, spawn poofs). */
export function burst(
  pool: ParticlePool,
  x: number,
  y: number,
  count: number,
  color: number,
  opts?: { speed?: number; life?: number; radius?: number },
): void {
  const speed = opts?.speed ?? 90;
  const life = opts?.life ?? 0.4;
  const radius = opts?.radius ?? 3;
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
      drag: 0.06,
    });
  }
}

/** A narrow directional mini-burst (hit-impact sparks, HERO SIGNATURE PASS
 * task item 3) — same per-particle spread as `burst()`, but confined to a
 * cone around `angle` instead of a full circle, so a struck-direction impact
 * reads as "this way" rather than an omnidirectional pop. */
export function burstDirectional(
  pool: ParticlePool,
  x: number,
  y: number,
  count: number,
  color: number,
  angle: number,
  opts?: { speed?: number; life?: number; radius?: number; spread?: number },
): void {
  const speed = opts?.speed ?? 100;
  const life = opts?.life ?? 0.28;
  const radius = opts?.radius ?? 2.5;
  const spread = opts?.spread ?? 1.2; // radians, total cone width
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const s = speed * (0.6 + Math.random() * 0.6);
    pool.spawn({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.7 + Math.random() * 0.6),
      radius: radius * (0.7 + Math.random() * 0.6),
      color,
      drag: 0.08,
    });
  }
}

/** Inward-converging sparkle (charge-up cue, item 4) — particles start on a
 * ring of `ringRadius` around (x,y) and drift TOWARD the center, the mirror
 * image of `burst()`. */
export function burstInward(
  pool: ParticlePool,
  x: number,
  y: number,
  count: number,
  color: number,
  ringRadius: number,
  opts?: { speed?: number; life?: number; radius?: number },
): void {
  const speed = opts?.speed ?? 80;
  const life = opts?.life ?? 0.18;
  const radius = opts?.radius ?? 2;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
    const r = ringRadius * (0.7 + Math.random() * 0.4);
    const s = speed * (0.7 + Math.random() * 0.5);
    pool.spawn({
      x: x + Math.cos(angle) * r,
      y: y + Math.sin(angle) * r,
      vx: -Math.cos(angle) * s,
      vy: -Math.sin(angle) * s,
      life,
      radius,
      color,
      drag: 0.02,
    });
  }
}

/** A shower of particles falling from above (boss-defeated gold rain). */
export function shower(
  pool: ParticlePool,
  centerX: number,
  width: number,
  topY: number,
  count: number,
  color: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = centerX + (Math.random() - 0.5) * width;
    pool.spawn({
      x,
      y: topY - Math.random() * 40,
      vx: (Math.random() - 0.5) * 20,
      vy: 20 + Math.random() * 40,
      life: 0.8 + Math.random() * 0.5,
      radius: 2.5 + Math.random() * 2,
      color,
      gravity: 220,
      drag: 1,
    });
  }
}
