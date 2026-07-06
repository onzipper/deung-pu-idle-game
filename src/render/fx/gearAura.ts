/**
 * M7 gear-wow: the "Super Saiyan" weapon aura for tier-6 / epic weapons — a
 * handful of flame-tongue shapes orbiting the weapon's anchor point, one slot
 * per hero (party-capped). Continuous/persistent (not event-driven), so this
 * is driven every frame from `FxController.update()` reading live `GameState`
 * directly, same convention as `weaponTrail.ts`/`castAura.ts`.
 *
 * Footgun 10 (CLAUDE.md): additive-blend fx white-out on bright daytime
 * scenes — every flame here is drawn SOLID on the default (normal) blend mode
 * plus a darker ember outline layer, never `blendMode: "add"`.
 *
 * Perf: each flame's shape is built ONCE (`buildFlameShape()`); every frame
 * only mutates position/rotation/scale/alpha (transform-only, per the
 * project's build-once-per-rig convention) — the shape is only rebuilt if its
 * color actually changes (rare: once per hero on equip), never per-frame.
 *
 * M7.6+ refine-prestige (+8/+9/+10, owner spec "make high refine +8/9/10
 * visually prestigious"): `setSlot()`'s optional `boosted` flag (driven by
 * `FxController` off `weaponRefine >= 8`) is the "+8: clearly stronger
 * presence" step — it does NOT add any new pooled Graphics (mobile-GPU
 * budget: stay within the existing `MAX_SLOTS * FLAMES_PER_SLOT` cap), it
 * just re-postures the SAME `FLAMES_PER_SLOT` flames into a two-radius
 * "inner+outer ring" layout (odd-indexed flames orbit further out) at a
 * faster/denser flicker — reads as a second layer ring at a glance without
 * growing the display-object count. The +9/+10 steps (intermittent crackle /
 * continuous signature beat) live in `fx/refinePrestige.ts`, driven off the
 * same anchor point.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE } from "@/render/theme";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------
const MAX_SLOTS = 3; // one aura per hero slot (party cap)
const FLAMES_PER_SLOT = 4; // capped — cheap on mobile GPU (<=12 Graphics total)
const FLAME_LEN = 10;
const FLAME_WIDTH = 4;
const ORBIT_RADIUS = 9;
const ORBIT_FLATTEN = 0.6; // squashed orbit so it hugs the weapon, not a full halo
const ORBIT_SPEED = 1.6; // rad/s — slow, lazy drift
const FLICKER_SPEED = 7; // rad/s — per-flame independent flicker rate
const SCALE_BASE = 0.85;
const SCALE_RANGE = 0.35;
const ALPHA_BASE = 0.55;
const ALPHA_RANGE = 0.35;
/** Per-second lerp rate the whole slot fades in/out by (activate/deactivate
 * reads as a quick bloom-in, not a hard pop). */
const FADE_RATE = 6;

// ---- M7.6+ refine-prestige "+8" boost (see module doc above) ---------------
/** Odd-indexed flames orbit this much further out than the base
 * `ORBIT_RADIUS` when boosted — the "second layer ring" read. */
const BOOST_OUTER_RING_MULT = 1.8;
/** Orbit + flicker speed multiplier while boosted — "faster" half of
 * "denser/faster". */
const BOOST_SPEED_MULT = 1.6;
/** Scale/alpha multiplier while boosted — "denser" half of "denser/faster". */
const BOOST_SCALE_MULT = 1.25;
const BOOST_ALPHA_MULT = 1.2;

interface Flame {
  root: Container;
  body: Graphics;
  outline: Graphics;
  angleOffset: number;
  flickerPhase: number;
  builtColor: number | null;
}

interface Slot {
  flames: Flame[];
  active: boolean;
  x: number;
  y: number;
  color: number;
  fade: number; // 0..1, eased toward `active ? 1 : 0`
  phase: number;
  /** M7.6+ refine-prestige "+8" step — see module doc above. */
  boosted: boolean;
}

/** Static tapered flame-tongue polygon, pointing "up" (-y) in local space —
 * built once per (re)color, never redrawn per frame. */
function buildFlameShape(body: Graphics, outline: Graphics, color: number, dark: number): void {
  const pts = [
    0,
    -FLAME_LEN,
    FLAME_WIDTH * 0.5,
    -FLAME_LEN * 0.3,
    FLAME_WIDTH * 0.3,
    FLAME_LEN * 0.25,
    0,
    FLAME_LEN * 0.4,
    -FLAME_WIDTH * 0.3,
    FLAME_LEN * 0.25,
    -FLAME_WIDTH * 0.5,
    -FLAME_LEN * 0.3,
  ];
  body.clear();
  outline.clear();
  body.poly(pts, true).fill(color);
  outline.poly(pts, true).stroke({ width: 1, color: dark, alpha: 0.85 });
}

export class GearAuraController {
  private readonly slots: Slot[] = [];

  constructor(private readonly container: Container) {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const flames: Flame[] = [];
      for (let i = 0; i < FLAMES_PER_SLOT; i++) {
        const root = new Container();
        const body = new Graphics();
        const outline = new Graphics();
        root.addChild(body, outline);
        root.visible = false;
        container.addChild(root);
        flames.push({
          root,
          body,
          outline,
          angleOffset: (Math.PI * 2 * i) / FLAMES_PER_SLOT,
          flickerPhase: Math.random() * Math.PI * 2,
          builtColor: null,
        });
      }
      this.slots.push({
        flames,
        active: false,
        x: 0,
        y: 0,
        color: 0xffffff,
        fade: 0,
        phase: Math.random() * Math.PI * 2,
        boosted: false,
      });
    }
  }

  /** Called once per hero slot per frame by `FxController` — `active=false`
   * simply lets the slot's fade ease back to invisible (never a hard pop).
   * `boosted` is the M7.6+ refine-prestige "+8" step (see module doc). */
  setSlot(
    slot: number,
    active: boolean,
    x: number,
    y: number,
    color: number,
    boosted = false,
  ): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.active = active;
    s.x = x;
    s.y = y;
    s.color = color;
    s.boosted = boosted;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      const target = s.active ? 1 : 0;
      s.fade += (target - s.fade) * Math.min(1, dt * FADE_RATE);
      if (s.fade < 0.02 && !s.active) {
        for (const f of s.flames) f.root.visible = false;
        continue;
      }
      const speedMult = s.boosted ? BOOST_SPEED_MULT : 1;
      s.phase += dt * ORBIT_SPEED * speedMult;
      s.flames.forEach((f, idx) => {
        if (f.builtColor !== s.color) {
          buildFlameShape(f.body, f.outline, s.color, PALETTE.auraFlameDark);
          f.builtColor = s.color;
        }
        f.flickerPhase += dt * FLICKER_SPEED * speedMult;
        const angle = s.phase + f.angleOffset;
        // Odd-indexed flames ride a further-out "second ring" while boosted
        // — same `FLAMES_PER_SLOT` Graphics, no new pooled objects.
        const ringMult = s.boosted && idx % 2 === 1 ? BOOST_OUTER_RING_MULT : 1;
        const ox = Math.cos(angle) * ORBIT_RADIUS * ringMult;
        const oy = Math.sin(angle) * ORBIT_RADIUS * ORBIT_FLATTEN * ringMult;
        const flick = Math.sin(f.flickerPhase);
        f.root.visible = true;
        f.root.position.set(s.x + ox, s.y + oy);
        f.root.rotation = angle + Math.PI / 2;
        const scaleMult = s.boosted ? BOOST_SCALE_MULT : 1;
        const alphaMult = s.boosted ? BOOST_ALPHA_MULT : 1;
        const scale = Math.max(0.05, (SCALE_BASE + flick * SCALE_RANGE * 0.5) * s.fade * scaleMult);
        f.root.scale.set(scale);
        f.root.alpha = Math.max(
          0,
          Math.min(1, (ALPHA_BASE + flick * ALPHA_RANGE * 0.5) * s.fade * alphaMult),
        );
      });
    }
  }

  destroy(): void {
    for (const s of this.slots) {
      for (const f of s.flames) {
        this.container.removeChild(f.root);
        f.root.destroy({ children: true });
      }
    }
    this.slots.length = 0;
  }
}
