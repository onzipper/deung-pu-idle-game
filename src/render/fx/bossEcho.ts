/**
 * Boss echo — a brief render-side "collapse forward" / "turn away and slide
 * out" for the boss's defeat/retreat beats.
 *
 * `state.boss` is set to `null` the SAME engine step `bossDefeated`/
 * `bossRetreat` fire (see `engine/systems/boss.ts`), so `GameRenderer`
 * destroys the live `BossView` before any animation could play on it — same
 * reasoning as `corpseEcho.ts` for regular enemies. Only one boss exists at a
 * time, so (unlike the enemy pool) a single reusable shape is enough — same
 * pattern as `arenaFlash.ts`. The existing particle burst + gold shower +
 * arena flash already cover the "impact"; this just adds the collapse/slide
 * silhouette flavor at the boss's last position.
 */

import { Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const DEFEAT_DURATION = 0.5;
const RETREAT_DURATION = 0.5;
const CORE_R = 34;

type EchoKind = "defeat" | "retreat";

export class BossEcho {
  private readonly g = new Graphics();
  private kind: EchoKind | null = null;
  private t = 0;
  private duration = 0;
  private x = 0;
  private y = 0;

  get view(): Graphics {
    return this.g;
  }

  trigger(kind: EchoKind, x: number, y: number): void {
    this.kind = kind;
    this.t = 0;
    this.duration = kind === "defeat" ? DEFEAT_DURATION : RETREAT_DURATION;
    this.x = x;
    this.y = y;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (!this.kind) return;
    this.t += dt;
    if (this.t >= this.duration) {
      this.kind = null;
      this.g.visible = false;
      this.g.clear();
      return;
    }
    const frac = this.t / this.duration;
    this.g.clear();
    if (this.kind === "defeat") {
      // Collapse forward and down, shrinking + fading.
      const r = safeRadius(CORE_R * (1 - frac * 0.7));
      this.g.position.set(this.x + frac * 14, this.y + frac * 30);
      this.g.rotation = frac * 0.7;
      this.g.regularPoly(0, 0, r, 6, Math.PI / 6).fill({
        color: PALETTE.boss,
        alpha: (1 - frac) * 0.8,
      });
    } else {
      // Turn-away lean + slide backward off, fading.
      const r = safeRadius(CORE_R * (1 - frac * 0.2));
      this.g.position.set(this.x + frac * 90, this.y);
      this.g.rotation = -frac * 0.3;
      this.g.regularPoly(0, 0, r, 6, Math.PI / 6).fill({
        color: PALETTE.muted,
        alpha: (1 - frac) * 0.7,
      });
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
