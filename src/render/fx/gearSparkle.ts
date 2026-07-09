/**
 * M7 gear-wow: subtle looping sparkle/glint for tier-5+ armor — a few tiny
 * pooled dots orbiting the hero's chest, twinkling in and out (pop-in/pop-out
 * "glint", not a constant glow). Continuous/persistent (not event-driven),
 * driven every frame from `FxController.update()` reading live `GameState`
 * directly — same convention as `gearAura.ts`.
 *
 * Perf: each glint's `Graphics` circle is built ONCE (`safeRadius()`-clamped);
 * every frame only mutates position/alpha (no per-frame path rebuild).
 *
 * M7.6+ refine-prestige (+8/+9/+10, owner spec): `setSlot()`'s optional
 * `boosted` flag (driven by `FxController` off `armorRefine >= 8`) is the
 * "+8: clearly stronger presence" step, applied the SAME way `gearAura.ts`
 * does — no new pooled Graphics (stays within `MAX_SLOTS * GLINTS_PER_SLOT`),
 * just a faster twinkle + a lower reveal threshold (denser) and odd-indexed
 * glints riding a further-out "second ring" orbit. The +9/+10 steps live in
 * `fx/refinePrestige.ts`.
 */

import { Container, Graphics } from "pixi.js";
import { MAX_PARTY_SIZE, safeRadius } from "@/render/theme";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------
const MAX_SLOTS = MAX_PARTY_SIZE; // one glint cluster per hero slot (party cap)
const GLINTS_PER_SLOT = 3; // small + subtle, per spec
const GLINT_RADIUS = 1.6;
const ORBIT_RX = 11;
const ORBIT_RY = 6;
const ORBIT_SPEED = 0.55; // slow drift around the chest
const TWINKLE_SPEED = 3.0; // rad/s, per-glint independent phase
/** Glints are only visibly bright for a fraction of their twinkle cycle
 * (`sin(phase) > threshold`) — reads as intermittent glints, not a glow. */
const TWINKLE_THRESHOLD = 0.4;
const TWINKLE_ALPHA_MAX = 0.9;
const FADE_RATE = 4; // per-second lerp toward active/inactive

// ---- M7.6+ refine-prestige "+8" boost (see module doc above) ---------------
const BOOST_OUTER_RING_MULT = 1.7;
const BOOST_SPEED_MULT = 1.7;
/** Lowers the effective twinkle threshold while boosted (more of the cycle
 * reads as bright) — the "denser" half of "denser/faster". */
const BOOST_THRESHOLD_MULT = 0.6;

interface Glint {
  g: Graphics;
  angleOffset: number;
  twinklePhase: number;
}

interface Slot {
  glints: Glint[];
  active: boolean;
  x: number;
  y: number;
  fade: number;
  phase: number;
  /** M7.6+ refine-prestige "+8" step — see module doc above. */
  boosted: boolean;
}

export class GearSparklePool {
  private readonly slots: Slot[] = [];

  constructor(private readonly container: Container) {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const glints: Glint[] = [];
      for (let i = 0; i < GLINTS_PER_SLOT; i++) {
        const g = new Graphics();
        g.circle(0, 0, safeRadius(GLINT_RADIUS)).fill({ color: 0xffffff, alpha: 1 });
        g.visible = false;
        container.addChild(g);
        glints.push({
          g,
          angleOffset: (Math.PI * 2 * i) / GLINTS_PER_SLOT,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
      this.slots.push({
        glints,
        active: false,
        x: 0,
        y: 0,
        fade: 0,
        phase: Math.random() * Math.PI * 2,
        boosted: false,
      });
    }
  }

  /** Called once per hero slot per frame by `FxController`. `boosted` is the
   * M7.6+ refine-prestige "+8" step (see module doc above). */
  setSlot(slot: number, active: boolean, x: number, y: number, boosted = false): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.active = active;
    s.x = x;
    s.y = y;
    s.boosted = boosted;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      const target = s.active ? 1 : 0;
      s.fade += (target - s.fade) * Math.min(1, dt * FADE_RATE);
      if (s.fade < 0.02 && !s.active) {
        for (const gl of s.glints) gl.g.visible = false;
        continue;
      }
      const speedMult = s.boosted ? BOOST_SPEED_MULT : 1;
      s.phase += dt * ORBIT_SPEED * speedMult;
      const threshold = s.boosted ? TWINKLE_THRESHOLD * BOOST_THRESHOLD_MULT : TWINKLE_THRESHOLD;
      s.glints.forEach((gl, idx) => {
        gl.twinklePhase += dt * TWINKLE_SPEED * speedMult;
        const angle = s.phase + gl.angleOffset;
        const wave = Math.sin(gl.twinklePhase);
        const bright = Math.max(0, (wave - threshold) / (1 - threshold));
        const alpha = bright * TWINKLE_ALPHA_MAX * s.fade;
        gl.g.visible = alpha > 0.01;
        if (gl.g.visible) {
          // Odd-indexed glints ride a further-out "second ring" while
          // boosted — same `GLINTS_PER_SLOT` Graphics, no new pooled objects.
          const ringMult = s.boosted && idx % 2 === 1 ? BOOST_OUTER_RING_MULT : 1;
          gl.g.position.set(
            s.x + Math.cos(angle) * ORBIT_RX * ringMult,
            s.y + Math.sin(angle) * ORBIT_RY * ringMult,
          );
          gl.g.alpha = alpha;
        }
      });
    }
  }

  destroy(): void {
    for (const s of this.slots) {
      for (const gl of s.glints) {
        this.container.removeChild(gl.g);
        gl.g.destroy();
      }
    }
    this.slots.length = 0;
  }
}
