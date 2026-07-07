/**
 * Owner request: a visible on-character effect while a hero's War Cry ATK
 * buff (`hero.atkBuffMult`/`atkBuffTimer`, engine `sword_warcry` skill —
 * NOW applies to every living hero, not just the caster) is active.
 *
 * Continuous/persistent per-hero read (same convention as `gearAura.ts`/
 * `gearSparkle.ts`): `FxController.updateWarCryFx()` reads `hero.atkBuffTimer`
 * every frame and drives this via `setSlot()`, never an event. Deliberately a
 * SEPARATE shape language + color family from every gear-aura/refine-prestige
 * effect so a buffed hero reads as "ATK up" at a glance, never confused with
 * a naturally-rolled tier-6/epic weapon or a +8/+9/+10 refined piece:
 *
 *  - A slow-pulsing crimson RIM GLOW (two static flat-alpha ellipses framing
 *    the whole silhouette, built once — only alpha/scale breathe).
 *  - 2-3 slow-rising upward CHEVRONS ("ATK up" reads naturally as an
 *    up-arrow), built once as filled polygons (never `arc()`/a runtime
 *    radius — sidesteps the negative-radius/arc-fill footguns entirely) and
 *    looping bottom-to-top around the anchor, each fading in/out over its own
 *    rise so nothing pops or vanishes hard.
 *
 * `setSlot()` takes a continuous `intensity` (0..1), not a boolean — the
 * caller ramps this down over the buff's final ~0.5s (see
 * `FxController.updateWarCryFx()`) so the whole aura fades out gracefully
 * instead of vanishing the instant `atkBuffTimer` hits 0. Footgun 10: flat/
 * solid on the DEFAULT (normal) blend mode, never additive.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const MAX_SLOTS = 3; // one aura per hero slot (party cap)
const CHEVRON_COUNT = 3; // "2-3 slow rising ember chevrons" per spec

/** Per-second lerp rate the whole slot's intensity eases toward its target —
 * fast enough to read as a quick bloom-in on cast, gentle enough that the
 * caller's own last-0.5s ramp-down (see `FxController`) still reads as a
 * graceful fade rather than a snap. */
const FADE_RATE = 6;

// ---- rim glow (static shape, alpha/scale breathe only) ---------------------
const RIM_RX = 13;
const RIM_RY = 27;
const RIM_PULSE_SPEED = 3.2; // rad/s — slow breathing, not a strobe
const RIM_ALPHA_BASE = 0.16;
const RIM_ALPHA_RANGE = 0.07;
const RIM_SCALE_RANGE = 0.03;
/** Rim ellipse is vertically centered a little below the chest anchor so it
 * frames the whole body (head to feet), not just the chest point itself. */
const RIM_CENTER_Y_OFFSET = 10;

// ---- rising chevrons ---------------------------------------------------
const CHEVRON_CYCLE = 1.8; // real seconds for one full bottom->top rise
const CHEVRON_RISE_BOTTOM = 26; // below the chest anchor (near the feet)
const CHEVRON_RISE_TOP = -34; // above the chest anchor (above the head)
const CHEVRON_FADE_IN_FRAC = 0.18;
const CHEVRON_FADE_OUT_FRAC = 0.28;
const CHEVRON_DRIFT_AMP = 2.5; // px, gentle horizontal sway while rising
const CHEVRON_DRIFT_SPEED = 2.1; // rad/s
const CHEVRON_ALPHA_PEAK = 0.85;
const CHEVRON_W = 6;
const CHEVRON_H = 5;
const CHEVRON_THICK = 2;

interface Chevron {
  root: Container;
  body: Graphics;
  /** 0..1, own position within `CHEVRON_CYCLE` — staggered per index so the
   * 2-3 chevrons read as an evenly-spaced rising column, not a single blob. */
  t: number;
  driftPhase: number;
}

interface Slot {
  rim: Graphics;
  chevrons: Chevron[];
  x: number;
  y: number;
  /** Target intensity (0..1) set by the caller every frame — see module doc. */
  targetIntensity: number;
  /** Eased current intensity (see `FADE_RATE`). */
  fade: number;
  pulsePhase: number;
}

/** Static filled chevron ("^" pointing up) — built ONCE at construction, a
 * fixed literal polygon (no runtime radius/arc call at all, so the two POC
 * bug classes don't even apply here). */
function buildChevronShape(g: Graphics): void {
  const w = CHEVRON_W;
  const h = CHEVRON_H;
  const t = CHEVRON_THICK;
  const pts = [-w, 0, -w + t, 0, 0, -h + t, w - t, 0, w, 0, 0, -h];
  g.clear();
  g.poly(pts, true).fill(PALETTE.warCryAura);
  g.poly(pts, true).stroke({ width: 1, color: PALETTE.warCryDark, alpha: 0.9 });
}

export class WarCryAuraController {
  private readonly slots: Slot[] = [];

  constructor(private readonly container: Container) {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const rim = new Graphics();
      rim.visible = false;
      rim.ellipse(0, 0, safeRadius(RIM_RX), safeRadius(RIM_RY)).fill({
        color: PALETTE.warCryCore,
        alpha: 0.1,
      });
      rim.ellipse(0, 0, safeRadius(RIM_RX), safeRadius(RIM_RY)).stroke({
        width: 1.5,
        color: PALETTE.warCryAura,
        alpha: 0.5,
      });
      container.addChild(rim);

      const chevrons: Chevron[] = [];
      for (let i = 0; i < CHEVRON_COUNT; i++) {
        const root = new Container();
        const body = new Graphics();
        buildChevronShape(body);
        root.addChild(body);
        root.visible = false;
        container.addChild(root);
        chevrons.push({
          root,
          body,
          t: i / CHEVRON_COUNT,
          driftPhase: Math.random() * Math.PI * 2,
        });
      }

      this.slots.push({
        rim,
        chevrons,
        x: 0,
        y: 0,
        targetIntensity: 0,
        fade: 0,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Called once per hero slot per frame by `FxController` — `intensity` is
   * a continuous 0..1 (not a boolean); the caller ramps it down over the
   * buff's final ~0.5s so the aura fades gracefully (see module doc). */
  setSlot(slot: number, intensity: number, x: number, y: number): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.targetIntensity = Math.max(0, Math.min(1, intensity));
    s.x = x;
    s.y = y;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      s.fade += (s.targetIntensity - s.fade) * Math.min(1, dt * FADE_RATE);
      if (s.fade < 0.02 && s.targetIntensity === 0) {
        s.rim.visible = false;
        for (const c of s.chevrons) c.root.visible = false;
        continue;
      }

      // ---- rim glow: static shape, breathing alpha/scale only ------------
      s.pulsePhase += dt * RIM_PULSE_SPEED;
      const pulse = Math.sin(s.pulsePhase);
      s.rim.visible = true;
      s.rim.position.set(s.x, s.y + RIM_CENTER_Y_OFFSET);
      s.rim.alpha = Math.max(0, (RIM_ALPHA_BASE + pulse * RIM_ALPHA_RANGE) * s.fade);
      const rimScale = 1 + pulse * RIM_SCALE_RANGE;
      s.rim.scale.set(rimScale, rimScale);

      // ---- rising chevrons -------------------------------------------------
      for (const c of s.chevrons) {
        c.t += dt / CHEVRON_CYCLE;
        if (c.t >= 1) c.t -= Math.floor(c.t);
        const y = CHEVRON_RISE_BOTTOM + (CHEVRON_RISE_TOP - CHEVRON_RISE_BOTTOM) * c.t;
        let curve = 1;
        if (c.t < CHEVRON_FADE_IN_FRAC) curve = c.t / CHEVRON_FADE_IN_FRAC;
        else if (c.t > 1 - CHEVRON_FADE_OUT_FRAC) curve = (1 - c.t) / CHEVRON_FADE_OUT_FRAC;
        const driftX =
          Math.sin(c.t * Math.PI * 2 * CHEVRON_DRIFT_SPEED + c.driftPhase) * CHEVRON_DRIFT_AMP;
        c.root.visible = curve > 0.02 && s.fade > 0.02;
        c.root.position.set(s.x + driftX, s.y + y);
        c.root.alpha = Math.max(0, Math.min(1, curve * CHEVRON_ALPHA_PEAK * s.fade));
      }
    }
  }

  destroy(): void {
    for (const s of this.slots) {
      this.container.removeChild(s.rim);
      s.rim.destroy();
      for (const c of s.chevrons) {
        this.container.removeChild(c.root);
        c.root.destroy({ children: true });
      }
    }
    this.slots.length = 0;
  }
}
