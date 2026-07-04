/**
 * Portal pool — the enemy "materialize" beat for spawn v2 (DEATH & SPAWN
 * DRAMA, 86d3k2qjk item 2): a small dark ground-portal ellipse opens at an
 * enemy's spawn point, holds while it steps out (the EXISTING spawn-hop /
 * landing-settle in `enemyView.ts` plays through this same window, plus a
 * synced fade-in — see that module's `SPAWN_FADE_DURATION`), then closes.
 *
 * One shared pool (spawns are triggered per-entity first-sight, tracked by
 * `FxController.updateEnemySpawns()` — see its doc comment for why that
 * detection lives there rather than here). A whole wave's enemies appear in
 * the SAME engine step, staggered only by x-position (`CONFIG.spawnGap`), so
 * concurrency stays low even without time-staggering; the ring-buffer
 * eviction below is a safety net for the rare large wave that exceeds the cap.
 *
 * Built once per spawn (two flat-alpha ellipses — dark fill + a kind-colored
 * rim stroke, no gradients) in LOCAL unit space; every frame after that only
 * touches `scale`/`alpha` (open -> hold -> close), never re-walks the path —
 * same build-once/transform-only convention as `crescent.ts`.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DEFAULT_CAP = 8;

/** Real seconds the portal takes to pop open. */
const OPEN_DURATION = 0.15;
/** Real seconds it stays fully open while the enemy steps out. */
const HOLD_DURATION = 0.15;
/** Real seconds it takes to close back down. */
const CLOSE_DURATION = 0.15;
const TOTAL_DURATION = OPEN_DURATION + HOLD_DURATION + CLOSE_DURATION;

/** Exported so `enemyView.ts`'s spawn fade-in can stay visually synced to
 * "the portal has finished opening" without importing this whole module. */
export const PORTAL_OPEN_DURATION = OPEN_DURATION;

interface PortalSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

/** Small overshoot-then-settle pop for the open (matches the "pop" other
 * spawn/revive beats in this pass use — see `heroView.ts`'s identical helper). */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const d = x - 1;
  return 1 + c3 * d * d * d + c1 * d * d;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class PortalPool {
  private readonly slots: PortalSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return { g, active: false, age: 0 };
    });
  }

  spawn(x: number, y: number, rimColor: number, size: number): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    const s = Math.max(0.3, size);
    const rx = safeRadius(15 * s);
    const ry = safeRadius(6 * s);

    slot.active = true;
    slot.age = 0;
    slot.g.visible = true;
    slot.g.alpha = 1;
    slot.g.position.set(x, y);
    slot.g.scale.set(0.0001);
    slot.g.clear();
    slot.g.ellipse(0, 0, rx, ry).fill({ color: 0x05060d, alpha: 0.55 });
    slot.g.ellipse(0, 0, rx, ry).stroke({ width: 2, color: rimColor, alpha: 0.6 });
  }

  /** Advance every live portal by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= TOTAL_DURATION) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }

      let scale: number;
      if (slot.age < OPEN_DURATION) {
        scale = Math.max(0.0001, easeOutBack(clamp01(slot.age / OPEN_DURATION)));
      } else if (slot.age < OPEN_DURATION + HOLD_DURATION) {
        scale = 1;
      } else {
        const p = clamp01((slot.age - OPEN_DURATION - HOLD_DURATION) / CLOSE_DURATION);
        scale = Math.max(0.0001, 1 - p);
      }
      slot.g.scale.set(scale, scale);
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      this.container.removeChild(slot.g);
      slot.g.destroy();
    }
    this.slots.length = 0;
  }
}
