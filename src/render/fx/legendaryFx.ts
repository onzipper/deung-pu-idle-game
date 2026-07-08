/**
 * "ตำราตำนาน" LEGENDARY weapon continuous fx (endgame v1.2/v1.3,
 * docs/endgame-design.md render wave) — the rarest look in the game gets two
 * ALWAYS-ON cues while a hero has a legendary weapon equipped
 * (`isLegendaryTemplate`), both driven every frame from `FxController.update()`
 * off live `GameState` (same convention as `gearAura.ts`/`gearSparkle.ts` —
 * NOT event-driven):
 *
 *  1. A per-class idle AMBIENT PARTICLE SIGNATURE at the weapon's business-end
 *     anchor (`heroView.ts`'s `getWeaponAnchorPos()`): sword = ember arc,
 *     bow = starfall, staff = rune orbit, ninja = shadow-wisp. This
 *     deliberately REPLACES the ordinary tier-6/epic "Super Saiyan" flame aura
 *     for a legendary weapon (see `FxController.updateGearFx()`'s
 *     `!isLegendaryTemplate` gate) rather than stacking on top of it — a
 *     craft-only legendary should read as its OWN thing, not "an epic drop
 *     plus extra dots".
 *  2. A short attack-swing motion trail sampled from the SAME anchor point,
 *     but only while `isHeroAttackSwinging()` is true — generalized across
 *     every class (unlike `weaponTrail.ts`'s swordsman-only ribbon), since a
 *     legendary staff/bow/dagger swing deserves the same kinetic read.
 *
 * Perf: fixed `MAX_SLOTS` (party cap) pools. Each slot's ambient dots are
 * built ONCE per (unchanging) class — every frame only mutates position/
 * alpha/rotation. The trail is one pooled ring-buffer polyline per slot
 * (same ring-buffer technique as `weaponTrail.ts`, just smaller/per-slot).
 * Footgun 10 (CLAUDE.md): every shape here is solid-fill/stroke on the
 * default (normal) blend mode, never `blendMode: "add"`.
 */

import { Container, Graphics } from "pixi.js";
import type { HeroClass } from "@/engine/entities";
import { PALETTE, safeRadius } from "@/render/theme";

const MAX_SLOTS = 3; // party cap, same convention as gearAura.ts/gearSparkle.ts

// ---------------------------------------------------------------------------
// Idle ambient particle signature (per class)
// ---------------------------------------------------------------------------
const AMBIENT_COUNT = 3; // per slot
const AMBIENT_FADE_RATE = 5; // per-second lerp toward active/inactive

const EMBER_CYCLE = 1.1; // seconds per rise-and-fade loop (sword)
const EMBER_RISE = 15;
const EMBER_DRIFT = 5;

const STAR_CYCLE = 1.5; // seconds per fall-and-fade loop (archer)
const STAR_FALL = 16;
const STAR_DRIFT = 5;
const STAR_TAIL_LEN = 4.5;

const RUNE_ORBIT_R = 13; // mage
const RUNE_ORBIT_RY = 0.5;
const RUNE_ORBIT_SPEED = 1.05; // rad/s
const RUNE_SIZE = 2.2;

const WISP_CYCLE = 1.7; // seconds per rise-and-fade loop (ninja)
const WISP_RISE = 13;
const WISP_SWAY = 6;

interface AmbientDot {
  g: Graphics;
  /** Own-cycle progress: 0..1 for ember/starfall/wisp (a repeating loop),
   * radians for the mage's steady rune orbit. */
  phase: number;
  /** Per-dot randomized offset so 3 dots in the same slot never move in
   * lockstep. */
  seed: number;
}

// ---------------------------------------------------------------------------
// Attack-swing motion trail (per slot, cross-class)
// ---------------------------------------------------------------------------
const TRAIL_MAX_POINTS = 10;
const TRAIL_POINT_LIFE = 0.13; // real seconds
const TRAIL_MIN_SAMPLE_DIST_SQ = 3 * 3;
const TRAIL_WIDTH_NEW = 4.2;
const TRAIL_WIDTH_OLD = 0.4;
const TRAIL_ALPHA_NEW = 0.65; // "subtle" per the render brief

interface TrailPoint {
  x: number;
  y: number;
  age: number; // real seconds since laid down; > TRAIL_POINT_LIFE = stale slot
}

interface Slot {
  cls: HeroClass | null;
  active: boolean;
  x: number;
  y: number;
  fade: number; // 0..1, eased toward active
  dots: AmbientDot[];
  builtCls: HeroClass | null;
  // ---- trail ----
  trailGfx: Graphics;
  trailPoints: TrailPoint[];
  trailHead: number;
  trailCount: number;
  lastTrailX: number;
  lastTrailY: number;
  hasTrailSample: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Build (or rebuild, on a class change — rare, once per hero on equip) the
 * ambient dot's static local-space shape. Never redrawn per frame. */
function buildAmbientDot(g: Graphics, cls: HeroClass): void {
  g.clear();
  if (cls === "swordsman") {
    // Ember: a small glowing coal with a darker rim.
    g.circle(0, 0, safeRadius(1.7)).fill({ color: PALETTE.auraFlameCore, alpha: 0.95 });
    g.circle(0, 0, safeRadius(1.7)).stroke({
      width: 0.7,
      color: PALETTE.auraFlameDark,
      alpha: 0.8,
    });
  } else if (cls === "archer") {
    // Starfall: a tiny 4-point star + a short falling tail.
    g.poly(
      [0, -2.1, 0.6, -0.6, 2.1, 0, 0.6, 0.6, 0, 2.1, -0.6, 0.6, -2.1, 0, -0.6, -0.6],
      true,
    ).fill({ color: PALETTE.gearApexCore, alpha: 0.95 });
    g.moveTo(0, 0)
      .lineTo(-STAR_TAIL_LEN * 0.3, -STAR_TAIL_LEN)
      .stroke({ width: 0.8, color: PALETTE.archerGoldGlint, alpha: 0.55 });
  } else if (cls === "mage") {
    // Rune: a small diamond glyph, gold-violet rimmed (ties it to the
    // legendary identity while still reading as "arcane rune").
    const pts = [0, -RUNE_SIZE, RUNE_SIZE * 0.7, 0, 0, RUNE_SIZE, -RUNE_SIZE * 0.7, 0];
    g.poly(pts, true).fill({ color: PALETTE.mageAzure, alpha: 0.85 });
    g.poly(pts, true).stroke({ width: 0.6, color: PALETTE.legendaryVioletDark, alpha: 0.7 });
  } else {
    // Ninja: a wispy violet tendril streak.
    g.moveTo(0, 2)
      .lineTo(0.8, -1.2)
      .lineTo(0, -4.2)
      .stroke({ width: 1.3, color: PALETTE.ninjaViolet, alpha: 0.6, cap: "round" });
  }
}

/** Advance one ambient dot's local offset/alpha/rotation for this frame —
 * transform-only (never touches the built shape). `fade` is the slot's own
 * in/out easing (0..1); `baseX`/`baseY` is the weapon anchor this frame. */
function updateAmbientDot(
  dot: AmbientDot,
  cls: HeroClass,
  dt: number,
  fade: number,
  baseX: number,
  baseY: number,
): void {
  const g = dot.g;
  if (cls === "swordsman") {
    dot.phase = (dot.phase + dt / EMBER_CYCLE) % 1;
    const t = dot.phase;
    g.position.set(
      baseX + Math.sin(t * Math.PI * 2 + dot.seed) * EMBER_DRIFT * t,
      baseY - t * EMBER_RISE,
    );
    g.alpha = fade * (1 - t) * 0.9;
  } else if (cls === "archer") {
    dot.phase = (dot.phase + dt / STAR_CYCLE) % 1;
    const t = dot.phase;
    g.position.set(
      baseX + Math.cos(dot.seed) * STAR_DRIFT,
      baseY - STAR_FALL * 0.5 + t * STAR_FALL,
    );
    g.alpha = fade * Math.sin(t * Math.PI) * 0.9;
  } else if (cls === "mage") {
    dot.phase += dt * RUNE_ORBIT_SPEED;
    const a = dot.phase + dot.seed;
    g.position.set(baseX + Math.cos(a) * RUNE_ORBIT_R, baseY + Math.sin(a) * RUNE_ORBIT_R * RUNE_ORBIT_RY);
    g.rotation = a;
    g.alpha = fade * 0.85;
  } else {
    dot.phase = (dot.phase + dt / WISP_CYCLE) % 1;
    const t = dot.phase;
    g.position.set(
      baseX + Math.sin(t * Math.PI * 2 + dot.seed) * WISP_SWAY * t,
      baseY - t * WISP_RISE,
    );
    g.alpha = fade * (1 - t) * 0.7;
  }
}

export class LegendaryFxController {
  private readonly slots: Slot[];

  constructor(private readonly container: Container) {
    this.slots = Array.from({ length: MAX_SLOTS }, () => {
      const dots: AmbientDot[] = Array.from({ length: AMBIENT_COUNT }, () => {
        const g = new Graphics();
        g.visible = false;
        container.addChild(g);
        return { g, phase: Math.random(), seed: Math.random() * Math.PI * 2 };
      });
      const trailGfx = new Graphics();
      container.addChild(trailGfx);
      return {
        cls: null,
        active: false,
        x: 0,
        y: 0,
        fade: 0,
        dots,
        builtCls: null,
        trailGfx,
        trailPoints: Array.from({ length: TRAIL_MAX_POINTS }, () => ({
          x: 0,
          y: 0,
          age: TRAIL_POINT_LIFE + 1, // start "already stale" (empty slot)
        })),
        trailHead: 0,
        trailCount: 0,
        lastTrailX: 0,
        lastTrailY: 0,
        hasTrailSample: false,
      };
    });
  }

  /** Called once per hero slot per frame by `FxController` — only while that
   * hero has a legendary weapon equipped. `active=false` eases the ambient
   * signature out (never a hard pop) and stops new trail sampling (existing
   * points still finish decaying). `swinging` gates whether THIS frame's
   * anchor position gets sampled into the trail ribbon. */
  setSlot(
    slot: number,
    active: boolean,
    cls: HeroClass | null,
    x: number,
    y: number,
    swinging: boolean,
  ): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.active = active;
    s.cls = cls;
    s.x = x;
    s.y = y;
    this.sampleTrail(s, active && swinging, x, y);
  }

  /** Advance every slot by `dt` REAL seconds (never sub-step count). */
  update(dt: number): void {
    for (const s of this.slots) {
      this.updateAmbient(s, dt);
      this.decayTrail(s, dt);
    }
  }

  destroy(): void {
    for (const s of this.slots) {
      for (const d of s.dots) {
        this.container.removeChild(d.g);
        d.g.destroy();
      }
      this.container.removeChild(s.trailGfx);
      s.trailGfx.destroy();
    }
    this.slots.length = 0;
  }

  // -------------------------------------------------------------------------

  private updateAmbient(s: Slot, dt: number): void {
    const target = s.active && s.cls ? 1 : 0;
    s.fade += (target - s.fade) * Math.min(1, dt * AMBIENT_FADE_RATE);
    if (s.fade < 0.02 && target === 0) {
      for (const d of s.dots) d.g.visible = false;
      return;
    }
    const cls = s.cls ?? s.builtCls;
    if (!cls) return;
    if (s.builtCls !== cls) {
      for (const d of s.dots) buildAmbientDot(d.g, cls);
      s.builtCls = cls;
    }
    for (const d of s.dots) {
      d.g.visible = true;
      updateAmbientDot(d, cls, dt, s.fade, s.x, s.y);
    }
  }

  private sampleTrail(s: Slot, sampling: boolean, x: number, y: number): void {
    if (!sampling) {
      s.hasTrailSample = false;
      return;
    }
    const dx = x - s.lastTrailX;
    const dy = y - s.lastTrailY;
    const movedEnough = !s.hasTrailSample || dx * dx + dy * dy >= TRAIL_MIN_SAMPLE_DIST_SQ;
    if (!movedEnough) return;
    const p = s.trailPoints[s.trailHead];
    p.x = x;
    p.y = y;
    p.age = 0;
    s.trailHead = (s.trailHead + 1) % TRAIL_MAX_POINTS;
    if (s.trailCount < TRAIL_MAX_POINTS) s.trailCount++;
    s.lastTrailX = x;
    s.lastTrailY = y;
    s.hasTrailSample = true;
  }

  private decayTrail(s: Slot, dt: number): void {
    let anyLive = false;
    for (const p of s.trailPoints) {
      if (p.age <= TRAIL_POINT_LIFE) {
        p.age += dt;
        if (p.age <= TRAIL_POINT_LIFE) anyLive = true;
      }
    }
    this.redrawTrail(s, anyLive);
  }

  private redrawTrail(s: Slot, anyLive: boolean): void {
    s.trailGfx.clear();
    // An EMPTY but VISIBLE Graphics still contributes a bounds point at its
    // own local origin (the same footgun `heroView.ts`'s `tierAccent` guards
    // against) — hide it outright whenever there's nothing to draw rather
    // than leaving a stale `visible = true` sitting at the origin.
    if (!anyLive || s.trailCount < 2) {
      s.trailGfx.visible = false;
      return;
    }
    s.trailGfx.visible = true;
    const oldestIdx = (s.trailHead - s.trailCount + TRAIL_MAX_POINTS) % TRAIL_MAX_POINTS;
    let prev: TrailPoint | null = null;
    for (let k = 0; k < s.trailCount; k++) {
      const p = s.trailPoints[(oldestIdx + k) % TRAIL_MAX_POINTS];
      if (p.age > TRAIL_POINT_LIFE) {
        prev = null; // stale slot — break the segment chain
        continue;
      }
      if (prev) {
        const frac = 1 - clamp01(p.age / TRAIL_POINT_LIFE); // 1 = brand new
        const width = safeRadius(TRAIL_WIDTH_OLD + (TRAIL_WIDTH_NEW - TRAIL_WIDTH_OLD) * frac);
        const alpha = TRAIL_ALPHA_NEW * frac;
        if (alpha > 0.01) {
          // Gold-violet two-tone trail, matching the rig's own edge accent —
          // a thin gold core stroke over a wider violet underlayer.
          s.trailGfx
            .moveTo(prev.x, prev.y)
            .lineTo(p.x, p.y)
            .stroke({ width: width * 1.5, color: PALETTE.legendaryViolet, alpha: alpha * 0.6, cap: "round" });
          s.trailGfx
            .moveTo(prev.x, prev.y)
            .lineTo(p.x, p.y)
            .stroke({ width, color: PALETTE.legendaryGold, alpha, cap: "round" });
        }
      }
      prev = p;
    }
  }
}
