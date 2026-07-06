/**
 * Archer "rain curtain" sweep (M7.7 "Skill Spectacle" per-class visual
 * language): a row of long, slightly-tilted falling streaks + a small
 * feather/wind glint at each one's head, staggered in with a per-slot DELAY
 * so a whole row reads as a curtain SWEEPING across the field left-to-right
 * (spatial order, not random) rather than popping in all at once. Used by
 * both the signature ARROW RAIN (a light dusting, tight cluster) and the
 * BARRAGE ultimate (`spawnField()` over the wide ±420 offset table — the
 * "screen-wide apocalyptic blanket" telegraph).
 *
 * Build-once-then-fade convention: each streak+glint pair is drawn ONCE when
 * its delay elapses; `update()` only eases alpha afterward.
 */

import { Container, Graphics } from "pixi.js";

/** Enough for a signature dusting (~9) AND a barrage sweep (~13) to overlap
 * briefly without evicting each other mid-sweep. */
const DEFAULT_CAP = 24;

type SlotState = "idle" | "waiting" | "active";

interface StreakSlot {
  g: Graphics;
  state: SlotState;
  delay: number;
  age: number;
  life: number;
  peakAlpha: number;
}

export interface SpawnStreakOptions {
  x: number;
  topY: number;
  bottomY: number;
  /** Real seconds to wait before this streak becomes visible (sweep stagger). */
  delay?: number;
  /** Real seconds visible once it appears. */
  life?: number;
  color: number;
  glintColor?: number;
  width?: number;
  alpha?: number;
}

export class CurtainSweepPool {
  private readonly slots: StreakSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, state: "idle" as SlotState, delay: 0, age: 0, life: 0.3, peakAlpha: 0.5 };
    });
  }

  /** Spawn one streak (used directly, or via `spawnField()` below). */
  spawn(opts: SpawnStreakOptions): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.delay = Math.max(0, opts.delay ?? 0);
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life ?? 0.3);
    slot.peakAlpha = opts.alpha ?? 0.5;
    slot.state = slot.delay > 0 ? "waiting" : "active";
    slot.g.visible = slot.state === "active";
    slot.g.alpha = 0;

    const tilt = (opts.bottomY - opts.topY) * 0.06; // slight lean, "wind" read
    slot.g.clear();
    slot.g
      .moveTo(opts.x, opts.topY)
      .lineTo(opts.x + tilt, opts.bottomY)
      .stroke({ width: opts.width ?? 2.2, color: opts.color, alpha: 0.75, cap: "round" });
    // A tiny brighter feather/wind glint riding the streak's head.
    const glint = opts.glintColor ?? opts.color;
    slot.g
      .moveTo(opts.x - 4, opts.topY)
      .lineTo(opts.x + tilt * 0.25, opts.topY + (opts.bottomY - opts.topY) * 0.18)
      .stroke({ width: (opts.width ?? 2.2) * 0.7, color: glint, alpha: 0.9, cap: "round" });
  }

  /**
   * Convenience: schedule one streak per offset entry, delay staggered by
   * SPATIAL INDEX (the offset tables are already ordered left-to-right, so
   * `i / (offsets.length - 1)` sweeps naturally in that order — no re-sort
   * needed) across `sweepSpan` real seconds.
   */
  spawnField(
    centerX: number,
    offsets: readonly { dx: number }[],
    opts: {
      topY: number;
      bottomY: number;
      color: number;
      glintColor?: number;
      width?: number;
      life?: number;
      alpha?: number;
      sweepSpan?: number;
    },
  ): void {
    const span = Math.max(0.01, opts.sweepSpan ?? 0.35);
    const n = Math.max(1, offsets.length - 1);
    offsets.forEach((off, i) => {
      this.spawn({
        x: centerX + off.dx,
        topY: opts.topY,
        bottomY: opts.bottomY,
        delay: (i / n) * span,
        life: opts.life,
        color: opts.color,
        glintColor: opts.glintColor,
        width: opts.width,
        alpha: opts.alpha,
      });
    });
  }

  /** Advance every slot by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.state === "idle") continue;
      if (slot.state === "waiting") {
        slot.delay -= dt;
        if (slot.delay <= 0) {
          slot.state = "active";
          slot.g.visible = true;
          slot.age = 0;
        }
        continue;
      }
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.state = "idle";
        slot.g.visible = false;
        continue;
      }
      const frac = slot.age / slot.life;
      // Quick fade in, ease out — reads as a passing streak, not a static line.
      const fadeIn = Math.min(1, frac / 0.25);
      const fadeOut = 1 - Math.max(0, (frac - 0.5) / 0.5);
      slot.g.alpha = slot.peakAlpha * Math.min(fadeIn, Math.max(0, fadeOut));
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
