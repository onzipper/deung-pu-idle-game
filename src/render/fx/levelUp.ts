/**
 * Level-up starburst pool (M5 "Character XP + Level system", 86d3jv7m3) —
 * the bespoke centerpiece shape for a hero's `levelUp` event: a bright core
 * + a handful of golden sunburst rays that pop outward then settle/fade.
 * `FxController.onLevelUp()` pairs this with its existing ring/particle/text
 * pools for the full "rising LEVEL UP" beat (ring pulse + gold sparkle burst
 * + rising label) — this module owns only the starburst shape itself, same
 * split as `lightPillar.ts`/`crescent.ts` own their own bespoke shape while
 * `FxController` composes the rest from shared pools.
 *
 * Every ray is built from a fully explicit `poly()` (never `Graphics.arc().
 * fill()` — see README's footgun note: an arc has no explicit `moveTo`, so
 * filling one collapses toward the path's stale pen position instead of the
 * arc's own coordinates). Every radius is `safeRadius()`-clamped. Flat-alpha
 * layered fills only, no canvas/gradient APIs.
 *
 * Capped tiny — a hero levels up far less often than it takes a hit (the xp
 * curve slows level-ups down quickly; see `engine/config` `leveling.xpToLevel`)
 * so more than a couple concurrent bursts is not a realistic case even with 3
 * heroes leveling in the same instant at 3x speed.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DEFAULT_CAP = 6;
const RAY_COUNT = 8;
const CORE_RADIUS = 6;
const RAY_LENGTH = 22;
/** Half-width (radians) of each ray's base — a narrow triangular spike. */
const RAY_HALF_WIDTH = 0.22;
/** Fraction of `duration` spent on the fast pop-out grow. */
const GROW_FRAC = 0.3;
/** Scale reached at the peak of the pop before settling back toward 1x. */
const POP_OVERSHOOT = 1.15;
/** Fraction of `duration` after which the burst starts fading. */
const FADE_START_FRAC = 0.55;

interface BurstSlot {
  g: Graphics;
  active: boolean;
  age: number;
  duration: number;
}

export interface SpawnLevelUpOptions {
  x: number;
  y: number;
  color: number;
  duration?: number;
}

/** Sampled triangular-ray points around `angle` — see module doc for why this
 * is a fully explicit `poly()` rather than an arc fill. */
function rayPoints(angle: number, coreR: number, length: number, halfWidth: number): number[] {
  const tipR = coreR + length;
  const a0 = angle - halfWidth;
  const a1 = angle + halfWidth;
  return [
    coreR * Math.cos(a0),
    coreR * Math.sin(a0),
    tipR * Math.cos(angle),
    tipR * Math.sin(angle),
    coreR * Math.cos(a1),
    coreR * Math.sin(a1),
  ];
}

export class LevelUpBurstPool {
  private readonly slots: BurstSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, duration: 0.5 };
    });
  }

  spawn(opts: SpawnLevelUpOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.1, opts.duration ?? 0.5);
    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.scale.set(0.3);
    slot.g.position.set(opts.x, opts.y);
    slot.g.clear();

    // Bright white-hot core + a golden halo, then N sunburst rays — layered
    // flat-alpha fills only (no gradients).
    slot.g.circle(0, 0, safeRadius(CORE_RADIUS)).fill({ color: 0xffffff, alpha: 0.9 });
    slot.g.circle(0, 0, safeRadius(CORE_RADIUS * 1.7)).fill({ color: opts.color, alpha: 0.5 });
    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / RAY_COUNT;
      slot.g
        .poly(rayPoints(angle, CORE_RADIUS * 0.8, RAY_LENGTH, RAY_HALF_WIDTH), true)
        .fill({ color: opts.color, alpha: 0.75 });
    }
  }

  /** Advance every live burst by `dt` real seconds: a quick pop past 1x,
   * settle back to 1x, then fade over the back half — no rotation (a clean
   * "pop", not a spin). */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.duration) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      const frac = slot.age / slot.duration;
      let scale: number;
      if (frac < GROW_FRAC) {
        const growth = frac / GROW_FRAC;
        const eased = 1 - (1 - growth) * (1 - growth);
        scale = 0.3 + eased * (POP_OVERSHOOT - 0.3);
      } else {
        const settleFrac = Math.min(1, (frac - GROW_FRAC) / (1 - GROW_FRAC));
        scale = POP_OVERSHOOT - settleFrac * (POP_OVERSHOOT - 1);
      }
      slot.g.scale.set(scale);
      slot.g.alpha =
        frac < FADE_START_FRAC ? 1 : Math.max(0, 1 - (frac - FADE_START_FRAC) / (1 - FADE_START_FRAC));
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
