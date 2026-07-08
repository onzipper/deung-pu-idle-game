/**
 * Ninja DASH fx (docs/ninja-design.md §7 "dash = เส้นเงา + afterimage สั้น") —
 * the render-side reaction to the engine's `heroDashed {heroId, fromX, toX}`
 * event (`engine/systems/dash.ts`), shared by every ninja skill that
 * repositions (เงาพริบ once, เงาสังหาร per chain hop up to 8x in ONE cast,
 * พันเงานิรันดร์ to the enemy centroid) — so `trigger()` can fire several times
 * within the same `consumeEvents()` call.
 *
 * Two pooled pieces per trigger, both built ONCE and only transformed/redrawn
 * per-trigger from here on (same "build once" convention as `ghostBlade.ts`):
 *  - a two-tone STREAK line from `fromX` to `toX` (a dark-violet glow
 *    underlayer + a bright silver core, footgun 10: solid on NORMAL blend,
 *    never additive) that fades fast — the "blink trail" read.
 *  - a brief static AFTERIMAGE silhouette left behind at the departure point
 *    (a simple humanoid smudge, not the full rig — this is a cheap pooled
 *    Graphics, not a `HeroView` snapshot).
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

/** A chain-dash ultimate (เงาสังหาร) can fire up to 8 hops in one cast, all
 * landing in the SAME engine step (all `heroDashed` events for that cast
 * arrive in one `consumeEvents()` call) — a little slack above 8 covers an
 * overlapping signature dash the same frame. */
const DASH_POOL_CAP = 10;

const STREAK_LIFE = 0.2;
const STREAK_GLOW_WIDTH = 5;
const STREAK_CORE_WIDTH = 2;
const STREAK_GLOW_ALPHA = 0.55;
const STREAK_CORE_ALPHA = 0.9;

const AFTERIMAGE_LIFE = 0.22;
const AFTERIMAGE_PEAK_ALPHA = 0.5;
/** Simple humanoid smudge dimensions — a rounded torso blob + a small head
 * dot, stylized (not a rig snapshot); built once per pool slot. */
const AFTERIMAGE_TORSO_RX = 5;
const AFTERIMAGE_TORSO_RY = 11;
const AFTERIMAGE_HEAD_R = 4.5;
const AFTERIMAGE_HEAD_OFFSET_Y = -16;

interface StreakSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

interface AfterimageSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

export class ShadowDashPool {
  private readonly streaks: StreakSlot[];
  private readonly afterimages: AfterimageSlot[];
  private streakCursor = 0;
  private afterimageCursor = 0;

  constructor(container: Container) {
    this.streaks = Array.from({ length: DASH_POOL_CAP }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0 };
    });
    this.afterimages = Array.from({ length: DASH_POOL_CAP }, () => {
      const g = new Graphics();
      // Built once — a stylized standing-figure smudge pointing along local
      // +y (feet at 0, head above); every trigger just repositions/tints/
      // fades it, same convention as `ghostBlade.ts`'s tapered sliver.
      g.ellipse(
        0,
        0,
        safeRadius(AFTERIMAGE_TORSO_RX),
        safeRadius(AFTERIMAGE_TORSO_RY),
      ).fill(PALETTE.ninjaViolet);
      g.circle(0, AFTERIMAGE_HEAD_OFFSET_Y, safeRadius(AFTERIMAGE_HEAD_R)).fill(
        PALETTE.ninjaViolet,
      );
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0 };
    });
  }

  /** Fire one dash's worth of streak + afterimage. Safe to call several
   * times within the same frame (chain-dash). */
  trigger(fromX: number, fromY: number, toX: number, toY: number): void {
    const streak = this.streaks[this.streakCursor];
    this.streakCursor = (this.streakCursor + 1) % this.streaks.length;
    streak.active = true;
    streak.age = 0;
    streak.g.visible = true;
    streak.g.alpha = 1;
    streak.g.clear();
    streak.g.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
      width: STREAK_GLOW_WIDTH,
      color: PALETTE.ninjaVioletDark,
      alpha: STREAK_GLOW_ALPHA,
      cap: "round",
    });
    streak.g.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
      width: STREAK_CORE_WIDTH,
      color: PALETTE.ninjaSilver,
      alpha: STREAK_CORE_ALPHA,
      cap: "round",
    });

    const ghost = this.afterimages[this.afterimageCursor];
    this.afterimageCursor = (this.afterimageCursor + 1) % this.afterimages.length;
    ghost.active = true;
    ghost.age = 0;
    ghost.g.visible = true;
    ghost.g.alpha = AFTERIMAGE_PEAK_ALPHA;
    ghost.g.position.set(fromX, fromY);
  }

  /** Advance every live streak/afterimage by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.streaks) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= STREAK_LIFE) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      slot.g.alpha = 1 - slot.age / STREAK_LIFE;
    }
    for (const slot of this.afterimages) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= AFTERIMAGE_LIFE) {
        slot.active = false;
        slot.g.visible = false;
        continue;
      }
      slot.g.alpha = AFTERIMAGE_PEAK_ALPHA * (1 - slot.age / AFTERIMAGE_LIFE);
    }
  }

  destroy(): void {
    for (const slot of [...this.streaks, ...this.afterimages]) {
      slot.g.parent?.removeChild(slot.g);
      slot.g.destroy();
    }
    this.streaks.length = 0;
    this.afterimages.length = 0;
  }
}
