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
      });
    }
  }

  /** Called once per hero slot per frame by `FxController` — `active=false`
   * simply lets the slot's fade ease back to invisible (never a hard pop). */
  setSlot(slot: number, active: boolean, x: number, y: number, color: number): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.active = active;
    s.x = x;
    s.y = y;
    s.color = color;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      const target = s.active ? 1 : 0;
      s.fade += (target - s.fade) * Math.min(1, dt * FADE_RATE);
      if (s.fade < 0.02 && !s.active) {
        for (const f of s.flames) f.root.visible = false;
        continue;
      }
      s.phase += dt * ORBIT_SPEED;
      for (const f of s.flames) {
        if (f.builtColor !== s.color) {
          buildFlameShape(f.body, f.outline, s.color, PALETTE.auraFlameDark);
          f.builtColor = s.color;
        }
        f.flickerPhase += dt * FLICKER_SPEED;
        const angle = s.phase + f.angleOffset;
        const ox = Math.cos(angle) * ORBIT_RADIUS;
        const oy = Math.sin(angle) * ORBIT_RADIUS * ORBIT_FLATTEN;
        const flick = Math.sin(f.flickerPhase);
        f.root.visible = true;
        f.root.position.set(s.x + ox, s.y + oy);
        f.root.rotation = angle + Math.PI / 2;
        const scale = Math.max(0.05, (SCALE_BASE + flick * SCALE_RANGE * 0.5) * s.fade);
        f.root.scale.set(scale);
        f.root.alpha = Math.max(0, (ALPHA_BASE + flick * ALPHA_RANGE * 0.5) * s.fade);
      }
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
