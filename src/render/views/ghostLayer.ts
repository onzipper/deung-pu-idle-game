/**
 * Ghost-presence render layer (docs/ghost-presence-design.md §3.5). Draws OTHER online
 * players in my zone as walk/idle-only "ghosts" beneath my own hero — no combat pose,
 * no fx, no camera/timeDirector/audio, no hit-testing (they live in a display container
 * excluded from `hitTestPointer`, which only scans `state.enemies`/`worldBoss`).
 *
 * Reuses the real `HeroView`/`updateHeroView` rig by feeding it a synthesized display-
 * only stub (`HeroRenderModel`) per ghost — the walk cycle falls out for free from the
 * per-frame x-delta the caller's interpolation supplies (heroView derives locomotion
 * from |dx|/dt). Pooled build-once, keyed by `cid` (mark-and-sweep), same contract as
 * `Pool`. Presence data NEVER reaches the engine; this layer only reads the render list
 * the ui-side `GhostStore` produces and mutates Pixi display objects.
 */

import { Container } from "pixi.js";
import type { HeroClass } from "@/engine";
import {
  createHeroView,
  updateHeroView,
  type HeroRenderModel,
  type HeroView,
} from "@/render/views/heroView";

/** One ghost to draw this frame. Structurally matches `GhostStore.GhostRenderItem` — kept
 *  as a LOCAL interface so `render/` takes no import from the app/ui layer (one-way flow). */
export interface GhostDrawItem {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  x: number;
  alpha: number;
}

/** A ghost's display-only Hero stub — inert everywhere the rig might read "combat" or
 *  "networked" state. `equipped: null/null` gives the plain bare tier look (see
 *  `buildGearWeapon`'s null contract); hp==maxHp + dead:false keeps the rig upright. */
function stub(item: GhostDrawItem): HeroRenderModel {
  return {
    cls: item.cls,
    x: item.x,
    aimX: null, // never faces a target — facing derives from walk velocity only
    equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
    tier: item.tier,
    shadowed: false,
    cd: 0,
    dead: false,
    hp: 1,
    maxHp: 1,
    reviveTimer: 0,
  };
}

export class GhostLayer {
  private readonly container: Container;
  private readonly views = new Map<string, HeroView>();

  constructor(parent: Container) {
    this.container = new Container();
    parent.addChild(this.container);
  }

  /** Rebuild the ghost display set for this frame. `dt` = the real render delta (drives
   *  the rig's walk/idle timers, exactly like `fx/`). `items` = the interpolated,
   *  capped, deduped render list from `GhostStore.list()`. */
  update(items: readonly GhostDrawItem[], dt: number): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.cid);
      let view = this.views.get(item.cid);
      if (!view) {
        view = createHeroView();
        this.views.set(item.cid, view);
        this.container.addChild(view);
      }
      // slot !== 0 shows the white nameplate (the existing display-name seam); empty
      // events = no attack/skill pose ever triggers, so ghosts stay walk/idle only.
      updateHeroView(view, stub(item), {
        dt,
        slot: 1,
        events: [],
        marching: false,
        displayName: item.name || null,
        socialBadge: null,
      });
      // Ghosts show no combat readout: hide the HP bar the rig draws for real heroes.
      view.hpBar.visible = false;
      // Whole-rig fade (in on appear, out before prune) — container alpha multiplies
      // through every child incl. the nameplate.
      view.alpha = item.alpha;
    }
    // Sweep ghosts that vanished from the list.
    for (const [cid, view] of this.views) {
      if (!seen.has(cid)) {
        this.container.removeChild(view);
        view.destroy({ children: true });
        this.views.delete(cid);
      }
    }
  }

  /** Full teardown (renderer destroy / StrictMode unmount). */
  destroy(): void {
    for (const view of this.views.values()) {
      this.container.removeChild(view);
      view.destroy({ children: true });
    }
    this.views.clear();
    this.container.destroy({ children: true });
  }
}
