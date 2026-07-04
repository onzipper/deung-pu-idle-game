/**
 * Archer ARROW RAIN skill's ground-side scene pieces (86d3k2t18): a small
 * growing "shadow" marker at each of the 9 drops' landing points while they
 * fall, and a brief arrow-stuck-in-ground decal (+ a dirt/feather puff,
 * spawned via the shared `ParticlePool`/`burst()` at the call site) once one
 * actually lands. Deliberately NOT the mage meteor's big rotating ground
 * rune (`runeGlyph.ts`) — this is a hail of small arrows, not a ritual, so
 * both pieces here stay small, cheap, and short-lived. `FxController` wires
 * these into the archer's `skillCast`/landing sequence; see its "ARROW RAIN
 * scene" knobs block.
 *
 * Same build-once-then-transform-only convention as `runeGlyph.ts`/
 * `armorShard.ts`: each shape is drawn ONCE per spawn; every frame after that
 * only updates scale/alpha (shadow) or alpha (ground-stuck arrow).
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

// ---- falling-shadow markers (pooled, cap ~12 — 9 drops + a little slack for
// 3x-speed overlap between casts; NOT the big rotating meteor rune) ---------
const SHADOW_CAP = 12;
const SHADOW_MAX_R = 7;
const SHADOW_MAX_ALPHA = 0.4;
/** Fraction of the shadow's life spent easing alpha in/out — mirrors
 * `runeGlyph.ts`'s fade shape so every "something is about to land" cue in
 * this codebase reads the same way. */
const SHADOW_FADE_IN_FRAC = 0.2;
const SHADOW_FADE_OUT_START = 0.8;

export interface SpawnRainShadowOptions {
  x: number;
  y: number;
  /** Real seconds until the arrow is expected to land — the shadow grows
   * from a pinprick to full size over this span (never sub-step count; see
   * the module doc comment / `FxController.update()`'s dt contract). */
  life: number;
  color: number;
}

interface RainShadowSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
}

export class RainShadowPool {
  private readonly slots: RainShadowSlot[];

  constructor(
    private readonly container: Container,
    cap: number = SHADOW_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0, life: 0.3 };
    });
  }

  /** Drop silently if every slot is busy (clutter guard: 9 drops per cast is
   * already at/under the cap in the common case; a saturated pool just means
   * a slightly-late second cast skips its own warning shadows rather than
   * evicting an in-flight one mid-fall, which would look like a bug). */
  trySpawn(opts: SpawnRainShadowOptions): void {
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return;

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life);
    slot.g.visible = true;
    slot.g.alpha = 0;
    slot.g.scale.set(0.12);
    slot.g.position.set(opts.x, opts.y);
    slot.g.clear();
    const r = safeRadius(SHADOW_MAX_R);
    slot.g.ellipse(0, 0, r, r * 0.4).fill({ color: opts.color, alpha: 1 });
  }

  /** Advance every live shadow by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      const frac = slot.age / slot.life;
      slot.g.scale.set(0.12 + 0.88 * frac);
      const fadeIn = Math.min(1, frac / SHADOW_FADE_IN_FRAC);
      const fadeOut = 1 - Math.max(0, (frac - SHADOW_FADE_OUT_START) / (1 - SHADOW_FADE_OUT_START));
      slot.g.alpha = SHADOW_MAX_ALPHA * Math.min(fadeIn, fadeOut);
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

// ---- ground-stuck arrow decal (pooled, cap ~10, ~0.6s fade) ----------------
const GROUND_ARROW_CAP = 10;
const GROUND_ARROW_LIFE = 0.6;
const GROUND_ARROW_LEN = 14;
/** Fraction of the decal's life spent fully visible before it eases out. */
const GROUND_ARROW_HOLD_FRAC = 0.55;

interface GroundArrowSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

export class GroundArrowPool {
  private readonly slots: GroundArrowSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = GROUND_ARROW_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0 };
    });
  }

  /** Spawn a small arrow sticking into the ground at `(x, groundY)`, fading
   * over ~0.6s — "sells rain of arrows landed" per spec. Ring-buffer pool
   * (oldest evicted first), same convention as `ParticlePool`. */
  spawn(x: number, groundY: number, fletchColor: number): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    const tilt = (Math.random() - 0.5) * 0.6; // a slight jaunty angle, not always upright
    slot.active = true;
    slot.age = 0;
    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.rotation = tilt;
    slot.g.position.set(x, groundY);
    slot.g.clear();

    const len = safeRadius(GROUND_ARROW_LEN);
    // Shaft (tail buried at the local origin, head poking up) — ivory/wood,
    // same tone as the live projectile's shaft.
    slot.g
      .moveTo(0, 0)
      .lineTo(0, -len)
      .stroke({ width: 1.8, color: PALETTE.ivory, alpha: 0.9, cap: "round" });
    // Steel head, same material language as the live arrow.
    slot.g
      .poly([0, -len - 4, -2.6, -len + 2, 2.6, -len + 2], true)
      .fill(PALETTE.steel);
    // Tiny fletch nub just above the ground line, archer-tinted.
    slot.g.poly([0, -1, -3, -4, 0.6, -2.2], true).fill({ color: fletchColor, alpha: 0.8 });
  }

  /** Advance every live decal by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= GROUND_ARROW_LIFE) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      const frac = slot.age / GROUND_ARROW_LIFE;
      slot.g.alpha =
        frac < GROUND_ARROW_HOLD_FRAC
          ? 1
          : Math.max(0, 1 - (frac - GROUND_ARROW_HOLD_FRAC) / (1 - GROUND_ARROW_HOLD_FRAC));
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
