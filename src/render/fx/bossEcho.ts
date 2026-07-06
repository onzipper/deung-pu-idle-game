/**
 * Boss echo — a brief render-side "collapse forward" for the boss-defeated
 * beat.
 *
 * `state.boss` is set to `null` the SAME engine step `bossDefeated` fires
 * (see `engine/systems/boss.ts`), so `GameRenderer` destroys the live
 * `BossView` before any animation could play on it — same reasoning as
 * `corpseEcho.ts` for regular enemies. Only one boss exists at a time, so
 * (unlike the enemy pool) a single reusable shape is enough — same pattern as
 * `arenaFlash.ts`. The existing particle burst + gold shower + arena flash
 * already cover the "impact"; this just adds the collapse silhouette flavor
 * at the boss's last position.
 *
 * M6 "World & Town" cleanup note: this used to also play a "turn away and
 * slide out" RETREAT variant for the `bossRetreat` event (team wiped, boss
 * backs off). That event is no longer emitted — a wipe now routes through
 * `respawnToTown` (walk home, revive in town; see `engine/systems/world.ts`)
 * instead of an in-place boss retreat — so the retreat variant was removed
 * rather than kept as dead code. The death beat itself is now the somber
 * `heroDown` extension in `FxController.onHeroDown()` + the audio tail in
 * `sfxMap.ts`'s `playHeroWalkHome`.
 */

import { Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const DEFEAT_DURATION = 0.5;
const CORE_R = 34;

export class BossEcho {
  private readonly g = new Graphics();
  private active = false;
  private t = 0;
  private x = 0;
  private y = 0;

  get view(): Graphics {
    return this.g;
  }

  trigger(x: number, y: number): void {
    this.active = true;
    this.t = 0;
    this.x = x;
    this.y = y;
    this.g.visible = true;
  }

  /** Advance by `dt` real seconds. */
  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.t >= DEFEAT_DURATION) {
      this.active = false;
      this.g.visible = false;
      this.g.clear();
      return;
    }
    const frac = this.t / DEFEAT_DURATION;
    this.g.clear();
    // Collapse forward and down, shrinking + fading.
    const r = safeRadius(CORE_R * (1 - frac * 0.7));
    this.g.position.set(this.x + frac * 14, this.y + frac * 30);
    this.g.rotation = frac * 0.7;
    this.g.regularPoly(0, 0, r, 6, Math.PI / 6).fill({
      color: PALETTE.boss,
      alpha: (1 - frac) * 0.8,
    });
  }

  destroy(): void {
    this.g.destroy();
  }
}
