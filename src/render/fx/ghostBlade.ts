/**
 * Swordsman whirlwind afterimages (HERO SIGNATURE PASS item 5): a handful of
 * static "the blade was here a moment ago" snapshots staggered across the
 * spin-skill's real-time window, each just fading in place. This is
 * deliberately distinct from the CONTINUOUS ribbon trail `weaponTrail.ts`
 * already draws during the spin (that one follows the live tip every frame);
 * these are discrete rotated copies, the classic arcade "afterimage" look.
 *
 * Self-timed off one `triggerSpin()` call (see `FxController`'s `skillCast`
 * handling) — no per-frame `HeroView` reads needed, matching the rest of the
 * edge-triggered spin juice (crescent nova, dust ring, camera punch).
 *
 * Shape is built ONCE per pool slot at construction (a small tapered blade
 * sliver) since only rotation/position/alpha/tint change per trigger — zero
 * redraw cost per frame, the same "build once, transform only" convention
 * `heroView.ts`'s rig uses.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

/** One afterimage per pool slot — also the stagger count across the spin. */
const GHOST_COUNT = 4;
/** Must stay <= `heroView.ts`'s `SPIN_DURATION` (0.4s) — the real-time window
 * the afterimages are staggered across (the spin sweeps one full turn in
 * that time). Kept as an explicit, commented constant rather than importing
 * heroView's private const, since these two modules communicate only
 * through `FxController`'s wiring, never directly. */
const SPIN_DURATION_REF = 0.4;
/** How long each individual afterimage takes to fade once it appears. */
const GHOST_FADE_DURATION = 0.2;
/** Approx blade length from the shoulder/pivot point used to place these —
 * a stylized match for `heroView.ts`'s swordsman blade geometry. */
const BLADE_LENGTH = 22;
const BLADE_WIDTH = 3;
/** Peak alpha for a freshly-shown afterimage (fades to 0 over its own life). */
const PEAK_ALPHA = 0.5;

interface GhostSlot {
  g: Graphics;
  pending: boolean;
  active: boolean;
  delay: number;
  age: number;
  x: number;
  y: number;
  angle: number;
  color: number;
}

export class GhostBladePool {
  private readonly slots: GhostSlot[];

  constructor(private readonly container: Container) {
    this.slots = Array.from({ length: GHOST_COUNT }, () => {
      const g = new Graphics();
      // A simple tapered sliver pointing along local +x from the origin —
      // built once; every trigger just repositions/re-tints/re-rotates it.
      g.poly([0, -BLADE_WIDTH, safeRadius(BLADE_LENGTH), 0, 0, BLADE_WIDTH], true).fill(
        PALETTE.steel,
      );
      g.visible = false;
      container.addChild(g);
      return {
        g,
        pending: false,
        active: false,
        delay: 0,
        age: 0,
        x: 0,
        y: 0,
        angle: 0,
        color: PALETTE.steel,
      };
    });
  }

  /** Kick off the staggered afterimage sequence for one spin cast, pivoted
   * around the swordsman's approximate body-center point `(x, y)`. */
  triggerSpin(x: number, y: number, color: number): void {
    for (let i = 0; i < GHOST_COUNT; i++) {
      const slot = this.slots[i];
      slot.pending = true;
      slot.active = false;
      slot.delay = (i / GHOST_COUNT) * SPIN_DURATION_REF;
      slot.x = x;
      slot.y = y;
      slot.angle = (i / GHOST_COUNT) * Math.PI * 2;
      slot.color = color;
    }
  }

  /** Advance every slot by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.pending) {
        slot.delay -= dt;
        if (slot.delay > 0) continue;
        slot.pending = false;
        slot.active = true;
        slot.age = 0;
        slot.g.visible = true;
        slot.g.tint = slot.color;
        slot.g.alpha = PEAK_ALPHA;
        slot.g.position.set(slot.x, slot.y);
        slot.g.rotation = slot.angle;
      }
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= GHOST_FADE_DURATION) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      slot.g.alpha = PEAK_ALPHA * (1 - slot.age / GHOST_FADE_DURATION);
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
