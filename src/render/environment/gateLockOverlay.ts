/**
 * Zone-gate LOCKED/OPEN live readout (R1 W2 "tappable gates" — owner: "อยากให้
 * เป็นการคลิกที่ตัวเกม เช่นการคลิกที่ประตู"). Sits on top of a themed archway
 * (`gateArch.ts`) or the grand boss door (`bossDoor.ts`), built ONCE at the
 * SAME `(x, groundY)` local origin — `zoneGateProps.ts`'s single call site.
 *
 * OPEN: a soft, low-alpha pulsing glow disc — "inviting", never a hard cutout.
 * LOCKED: a code-drawn padlock glyph + a small kill-progress bar fed the SAME
 * `state.kills` / `CONFIG.killGoal(zone.stage)` values the HUD's own
 * `hud.zoneUnlockLabel` gauge reads (`GoalLadder.tsx`) — never a second
 * source of truth for "how close is this zone to unlocking".
 *
 * Continuous per-frame read/transform-only, same convention as
 * `bossDoor.ts`'s own locked/unlocked look: `setState()` is a cheap data
 * write, `update(dt)` only touches alpha/visible + (LOCKED only) redraws the
 * tiny progress-bar fill rect in place (`Graphics.clear()` + refill, same
 * pattern `hpBar.ts` uses every frame — cheap, no path rebuild of the padlock
 * itself). Every curve is point-sampled `poly()` (footgun 2: `arc().fill()`
 * collapses toward the stale pen position); every radius `safeRadius()`-clamped.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const BAR_WIDTH = 40;
const BAR_HEIGHT = 5;
const GLOW_R = 20;
const PULSE_SPEED = 1.6;

/** Sampled points around the TOP half of a circle (a shackle arc), for
 * `Graphics.poly(pts, false).stroke(...)` — never `Graphics.arc()` (footgun 2). */
function shacklePoints(cx: number, cy: number, r: number, segments = 8): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (Math.PI * i) / segments;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

export class GateLockOverlay {
  readonly view = new Container();
  private readonly glow: Graphics;
  private readonly padlock: Graphics;
  private readonly bar: Graphics;
  private readonly barY: number;

  private phase = Math.random() * Math.PI * 2;
  private locked = false;
  private progress = 0;
  private goal = 1;

  /** `archTopY` = the local (negative, above-ground) y of the gate's own
   * lintel/frame top — `gateArch.ts`'s `ARCH_TOP` or `bossDoor.ts`'s
   * `BOSS_DOOR_ARCH_TOP` — so this overlay always hangs just above whichever
   * gate it's paired with regardless of family/size. */
  constructor(x: number, groundY: number, archTopY: number) {
    this.view.position.set(x, groundY);

    this.glow = new Graphics();
    this.glow.circle(0, archTopY + 8, safeRadius(GLOW_R)).fill({ color: PALETTE.gold, alpha: 1 });
    this.view.addChild(this.glow);

    const bw = 15;
    const bh = 12;
    const bodyY = archTopY - 8;
    this.padlock = new Graphics();
    this.padlock
      .roundRect(-bw / 2, bodyY, safeRadius(bw), safeRadius(bh), 2)
      .fill({ color: PALETTE.outline, alpha: 0.92 });
    this.padlock
      .poly(shacklePoints(0, bodyY, safeRadius(bw * 0.34)), false)
      .stroke({ width: 2.5, color: PALETTE.steel, alpha: 0.85 });
    this.padlock.circle(0, bodyY + bh * 0.55, safeRadius(1.6)).fill({ color: PALETTE.steel, alpha: 0.9 });
    this.view.addChild(this.padlock);

    this.barY = archTopY + 4;
    this.bar = new Graphics();
    this.view.addChild(this.bar);
  }

  /** Continuous read (`FxController`/`bossDoor.ts` convention): the caller
   * re-derives locked/progress every frame from live `GameState` and just
   * tells us the answer — this class never reaches into engine state itself. */
  setState(locked: boolean, progress: number, goal: number): void {
    this.locked = locked;
    this.progress = progress;
    this.goal = goal;
  }

  /** Read-only inspection (used by `zoneGateProps.ts`'s callers/tests — the
   * live `locked` flag `setState()` last wrote). */
  isLocked(): boolean {
    return this.locked;
  }

  update(dt: number): void {
    this.phase += dt * PULSE_SPEED;
    const pulse = 0.5 + 0.5 * Math.sin(this.phase);

    this.glow.visible = !this.locked;
    this.glow.alpha = 0.14 + 0.1 * pulse;
    this.padlock.visible = this.locked;
    this.padlock.alpha = 0.82 + 0.12 * pulse;
    this.bar.visible = this.locked;

    if (this.locked) {
      this.bar.clear();
      const w = safeRadius(BAR_WIDTH);
      const h = safeRadius(BAR_HEIGHT);
      const r = Math.min(2, h / 2);
      const pct = this.goal > 0 ? Math.max(0, Math.min(1, this.progress / this.goal)) : 0;
      this.bar.roundRect(-w / 2, this.barY, w, h, r).fill({ color: PALETTE.shadow, alpha: 0.55 });
      if (pct > 0) {
        this.bar
          .roundRect(-w / 2, this.barY, safeRadius(w * pct), h, r)
          .fill({ color: PALETTE.hpGood, alpha: 0.9 });
      }
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
