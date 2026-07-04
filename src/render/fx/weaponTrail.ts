/**
 * Swordsman weapon trail + charge speed-lines — the two "kinetic energy" cues
 * that need to sample the swordsman's LIVE rig every frame (via the small
 * readonly hooks `heroView.ts` exports: `getSwordTipPos`/`isSwordSwinging`)
 * rather than react to a discrete `GameEvent`. A swing/spin animation plays
 * across many frames with no per-frame event of its own, which doesn't fit
 * the edge-triggered `consumeEvents()` shape the rest of `fx/` uses for
 * numbers/flashes/pops — `FxController.update()` feeds this controller a
 * small per-frame `WeaponTrailFrame` instead (see its call site).
 *
 * Trail implementation choice: a POOLED GRAPHICS POLYLINE (a fixed-size ring
 * buffer of `{x,y,age}` points, capped at 16, zero per-frame allocation) —
 * NOT a `MeshRope`. A rope needs a strip texture and introduces a second Pixi
 * primitive family into a renderer that otherwise draws everything with
 * plain `Graphics` (rings.ts/particles.ts/hpBar.ts/the rig itself); a
 * handful of short alpha+width-tapered stroke segments reuses that exact
 * vocabulary and is trivially cheap at this point count.
 *
 * One instance total — the roster has at most one swordsman.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

// ---- sword trail ribbon ----------------------------------------------------
const TRAIL_MAX_POINTS = 16;
/** Real seconds a laid-down point takes to fully fade from the ribbon. */
const TRAIL_POINT_LIFE = 0.16;
/** Skip adding a new point unless the tip moved at least this far (world px,
 * squared) since the last sample — keeps the ribbon from clumping into a
 * solid blob while the tip is barely moving (start/end of a swing). */
const TRAIL_MIN_SAMPLE_DIST_SQ = 3 * 3;
const TRAIL_WIDTH_NEW = 6;
const TRAIL_WIDTH_OLD = 0.5;
const TRAIL_ALPHA_NEW = 0.75;

interface TrailPoint {
  x: number;
  y: number;
  /** Real seconds since this point was laid down; `> TRAIL_POINT_LIFE` means
   * "stale" — an unused ring slot, or a point that has fully faded. */
  age: number;
}

// ---- charge speed-lines -----------------------------------------------------
const SPEED_LINE_COUNT = 5;
/** World px/s — between the calm hold-formation walk (`CONFIG.heroMove` =
 * 150) and the charge sprint (`CONFIG.chargeSpeed` = 265), so only an actual
 * charge trips this, not ordinary marching. */
const SPEED_LINE_VELOCITY_THRESHOLD = 200;
const SPEED_LINE_SPAWN_INTERVAL = 0.045; // real seconds between new streaks while charging
const SPEED_LINE_LIFE = 0.22;
const SPEED_LINE_LENGTH = 16;
const SPEED_LINE_BEHIND_MIN = 8;
const SPEED_LINE_BEHIND_MAX = 34;
const SPEED_LINE_Y_JITTER = 26; // spread around body height

interface SpeedLineSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

/** Per-frame input the controller needs, gathered by `FxController` from live
 * `GameState` + the swordsman's `HeroView` — nothing here is derivable from
 * `GameEvent`s alone (see the module doc comment). */
export interface WeaponTrailFrame {
  /** World-space weapon-tip position this frame. */
  tip: { x: number; y: number };
  /** True while a swing/spin attack anim is actively playing. */
  swinging: boolean;
  /** The swordsman's locomotion (body) x this frame — drives the speed-line
   * "charging" detector independently of the tip's own swing wobble. */
  bodyX: number;
  color: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class WeaponTrailController {
  private readonly trailGfx = new Graphics();
  // Fixed-size ring buffer, oldest overwritten first via `head`; insertion
  // order == age order (all resident points age at the same real-time rate,
  // and we never reorder), so the draw pass below needs no per-frame sort.
  private readonly points: TrailPoint[] = Array.from({ length: TRAIL_MAX_POINTS }, () => ({
    x: 0,
    y: 0,
    age: TRAIL_POINT_LIFE + 1, // start "already stale" (empty slot)
  }));
  private head = 0;
  private count = 0;
  private lastSampleX = 0;
  private lastSampleY = 0;
  private hasSample = false;

  private readonly speedLines: SpeedLineSlot[];
  private speedLineCursor = 0;
  private speedLineSpawnT = 0;
  private lastBodyX = 0;
  private hasBodyX = false;

  constructor(layer: Container) {
    layer.addChild(this.trailGfx);
    this.speedLines = Array.from({ length: SPEED_LINE_COUNT }, () => {
      const g = new Graphics();
      g.visible = false;
      layer.addChild(g);
      return { g, active: false, age: 0 };
    });
  }

  /** Advance by `dt` REAL seconds. `frame` is null when there's no live
   * (non-dead) swordsman this frame — existing trail/streaks still finish
   * decaying, but no new ones are added. */
  update(dt: number, frame: WeaponTrailFrame | null): void {
    this.updateTrail(dt, frame);
    this.updateSpeedLines(dt, frame);
  }

  destroy(): void {
    this.trailGfx.destroy();
    for (const slot of this.speedLines) slot.g.destroy();
  }

  // -------------------------------------------------------------------------

  private updateTrail(dt: number, frame: WeaponTrailFrame | null): void {
    let anyLive = false;
    for (const p of this.points) {
      if (p.age <= TRAIL_POINT_LIFE) {
        p.age += dt;
        if (p.age <= TRAIL_POINT_LIFE) anyLive = true;
      }
    }

    if (frame?.swinging) {
      const dx = frame.tip.x - this.lastSampleX;
      const dy = frame.tip.y - this.lastSampleY;
      const movedEnough = !this.hasSample || dx * dx + dy * dy >= TRAIL_MIN_SAMPLE_DIST_SQ;
      if (movedEnough) {
        this.pushPoint(frame.tip.x, frame.tip.y);
        this.lastSampleX = frame.tip.x;
        this.lastSampleY = frame.tip.y;
        this.hasSample = true;
        anyLive = true;
      }
    } else {
      this.hasSample = false;
    }

    this.redrawTrail(frame?.color ?? 0xffffff, anyLive);
  }

  private pushPoint(x: number, y: number): void {
    const slot = this.points[this.head];
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    this.head = (this.head + 1) % TRAIL_MAX_POINTS;
    if (this.count < TRAIL_MAX_POINTS) this.count++;
  }

  private redrawTrail(color: number, anyLive: boolean): void {
    this.trailGfx.clear();
    if (!anyLive || this.count < 2) return;

    // Walk the ring oldest -> newest so the ribbon tapers thin/faint (old)
    // to thick/bright (new). No allocation: plain index math over the fixed
    // backing array.
    const oldestIdx = (this.head - this.count + TRAIL_MAX_POINTS) % TRAIL_MAX_POINTS;
    let prev: TrailPoint | null = null;
    for (let k = 0; k < this.count; k++) {
      const p = this.points[(oldestIdx + k) % TRAIL_MAX_POINTS];
      if (p.age > TRAIL_POINT_LIFE) {
        prev = null; // stale slot — break the segment chain, don't draw garbage
        continue;
      }
      if (prev) {
        const frac = 1 - clamp01(p.age / TRAIL_POINT_LIFE); // 1 = brand new
        const width = safeRadius(TRAIL_WIDTH_OLD + (TRAIL_WIDTH_NEW - TRAIL_WIDTH_OLD) * frac);
        const alpha = TRAIL_ALPHA_NEW * frac;
        if (alpha > 0.01) {
          this.trailGfx
            .moveTo(prev.x, prev.y)
            .lineTo(p.x, p.y)
            .stroke({ width, color, alpha, cap: "round" });
        }
      }
      prev = p;
    }
  }

  private updateSpeedLines(dt: number, frame: WeaponTrailFrame | null): void {
    for (const slot of this.speedLines) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= SPEED_LINE_LIFE) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      slot.g.alpha = 1 - slot.age / SPEED_LINE_LIFE;
    }

    this.speedLineSpawnT = Math.max(0, this.speedLineSpawnT - dt);

    if (!frame) {
      this.hasBodyX = false;
      return;
    }
    const velocity = this.hasBodyX ? (frame.bodyX - this.lastBodyX) / Math.max(dt, 1e-6) : 0;
    this.lastBodyX = frame.bodyX;
    this.hasBodyX = true;

    if (velocity > SPEED_LINE_VELOCITY_THRESHOLD && this.speedLineSpawnT <= 0) {
      this.spawnSpeedLine(frame);
      this.speedLineSpawnT = SPEED_LINE_SPAWN_INTERVAL;
    }
  }

  private spawnSpeedLine(frame: WeaponTrailFrame): void {
    const slot = this.speedLines[this.speedLineCursor];
    this.speedLineCursor = (this.speedLineCursor + 1) % this.speedLines.length;

    slot.active = true;
    slot.age = 0;
    const behind =
      SPEED_LINE_BEHIND_MIN + Math.random() * (SPEED_LINE_BEHIND_MAX - SPEED_LINE_BEHIND_MIN);
    const x = frame.bodyX - behind;
    const y = frame.tip.y - SPEED_LINE_Y_JITTER / 2 + Math.random() * SPEED_LINE_Y_JITTER;

    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.clear();
    slot.g
      .moveTo(x, y)
      .lineTo(x - SPEED_LINE_LENGTH, y)
      .stroke({ width: 2, color: frame.color, alpha: 0.6, cap: "round" });
  }
}
