/**
 * The mage meteor's two non-rune pieces (HERO SIGNATURE PASS item 11): a
 * brief top-of-arena sky flash at cast time, and a handful of glowing scorch
 * patches left behind on impact. The falling ground rune + the thicker fire
 * tracer are handled by `runeGlyph.ts` / `tracer.ts` respectively —
 * `FxController` wires all three into one "meteor is a scene" sequence.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

// ---- sky flash --------------------------------------------------------------
// Single reusable shape: at most one meteor cast reads as meaningfully
// visible at a time in practice (12s skill cooldown) — same "one shared
// shape" reasoning as `arenaFlash.ts`/`bossEcho.ts`, just height-limited to
// read as "the sky", not the whole arena.
const SKY_FLASH_DURATION = 0.22;
const SKY_FLASH_HEIGHT = 70;
const SKY_FLASH_MARGIN = 40;

export class MeteorSkyFlash {
  private readonly g = new Graphics();
  private t = 0;
  private peak = 0;

  constructor(worldWidth: number) {
    this.g
      .rect(-SKY_FLASH_MARGIN, -SKY_FLASH_MARGIN, worldWidth + SKY_FLASH_MARGIN * 2, SKY_FLASH_HEIGHT)
      .fill(0xffffff);
    this.g.alpha = 0;
    this.g.visible = false;
  }

  get view(): Graphics {
    return this.g;
  }

  /** Trigger (or brighten) the flash. `peakAlpha` in [0,1], subtle by design. */
  trigger(color: number, peakAlpha = 0.28): void {
    this.g.tint = color;
    this.peak = Math.max(this.peak, peakAlpha);
    this.t = SKY_FLASH_DURATION;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t = Math.max(0, this.t - dt);
    const frac = this.t / SKY_FLASH_DURATION;
    this.g.alpha = this.peak * frac;
    if (this.t === 0) {
      this.g.visible = false;
      this.peak = 0;
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}

// ---- scorch patches (pooled, cap 3, ~2s fade) -------------------------------
const SCORCH_CAP = 3;
const SCORCH_DURATION = 2.0;
const SCORCH_HOLD_FRAC = 0.3; // stay near-full for the first 30% of the fade

interface ScorchSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

export class ScorchPool {
  private readonly slots: ScorchSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = SCORCH_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0 };
    });
  }

  /** Spawn a glowing scorch patch centered at `(x, y)` (ground level). */
  spawn(x: number, y: number, glowColor: number): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.age = 0;
    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.position.set(x, y);
    slot.g.clear();
    const rOuter = safeRadius(46);
    const rInner = safeRadius(30);
    slot.g.ellipse(0, 0, rOuter, rOuter * 0.32).fill({ color: 0x0a0604, alpha: 0.55 });
    slot.g.ellipse(0, 0, rInner, rInner * 0.32).fill({ color: glowColor, alpha: 0.28 });
  }

  /** Advance every live scorch by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= SCORCH_DURATION) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      // A burn mark that lingers, then eases out — not a visibly-draining timer.
      const frac = slot.age / SCORCH_DURATION;
      slot.g.alpha =
        frac < SCORCH_HOLD_FRAC ? 1 : Math.max(0, 1 - (frac - SCORCH_HOLD_FRAC) / (1 - SCORCH_HOLD_FRAC));
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
