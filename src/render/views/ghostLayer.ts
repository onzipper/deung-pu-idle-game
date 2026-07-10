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
import { scatterPlaneY, type HeroClass } from "@/engine";
import { GROUND_Y } from "@/render/layout";
import { depthZIndex } from "@/render/worldDepth/depthBand";
import type { WorldFxContext } from "@/render/worldDepth/worldFxContext";
import {
  createHeroView,
  playHeroPosePulse,
  updateHeroView,
  type HeroPosePulse,
  type HeroRenderModel,
  type HeroView,
} from "@/render/views/heroView";

/** The R3 visual-action values a peer may broadcast (mirrors `GhostStore.GhostActionKind`
 *  — kept LOCAL so `render/` imports nothing from the app/ui layer). */
export type GhostActionKind =
  | "idle"
  | "walk"
  | "basic"
  | "skill1"
  | "skill2"
  | "skill3"
  | "skill4"
  | "dash";

/** RENDER-ONLY pose intent (NOT a `GameEvent`): the rig pulse a `pa` action maps to. Only
 *  one-shot actions map; `idle`/`walk` map to `null` (locomotion falls out of the x-lerp,
 *  no pulse). skill1-4 collapse to the single class skill pose the rig already has. */
type GhostPose = HeroPosePulse | null;

function actionToPose(a: GhostActionKind | undefined): GhostPose {
  switch (a) {
    case "basic":
      return "basic";
    case "skill1":
    case "skill2":
    case "skill3":
    case "skill4":
      return "skill";
    case "dash":
      return "dash";
    default:
      return null; // idle / walk / undefined -> locomotion only
  }
}

/** How far ahead of the ghost's x the synthetic aim sits when a `pa` facing is known —
 *  comfortably past the rig's combat-aim deadband so the flip is decisive. */
const FACING_AIM_REACH = 100;

/** One ghost to draw this frame. Structurally matches `GhostStore.GhostRenderItem` — kept
 *  as a LOCAL interface so `render/` takes no import from the app/ui layer (one-way flow).
 *  `facing`/`action`/`at` are present ONLY for a peer seen via the R3 `pa` stream; a plain
 *  `p`-only ghost omits them and renders exactly as before (walk/idle, velocity facing). */
export interface GhostDrawItem {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  x: number;
  alpha: number;
  facing?: 1 | -1;
  action?: GhostActionKind;
  at?: number;
}

/** A ghost's display-only Hero stub — inert everywhere the rig might read "combat" or
 *  "networked" state. `equipped: null/null` gives the plain bare tier look (see
 *  `buildGearWeapon`'s null contract); hp==maxHp + dead:false keeps the rig upright.
 *  Facing: a `pa` peer sets an explicit facing via a synthetic `aimX` (the ONLY thing
 *  `aimX` drives in `updateHeroView` — pure rig flip, no combat behavior); a `p`-only peer
 *  keeps `aimX: null`, so facing derives from walk velocity exactly as before. */
function stub(item: GhostDrawItem): HeroRenderModel {
  const aimX = item.facing !== undefined ? item.x + item.facing * FACING_AIM_REACH : null;
  return {
    cls: item.cls,
    x: item.x,
    aimX,
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
  /** Per-ghost last PLAYED action counter (`pa.at`) — the edge-trigger memory: a pose
   *  fires only when a peer's counter ADVANCES past this, so a re-delivered/held `at` never
   *  restarts the pose (matches the store's own stale-`at` rejection one layer up). */
  private readonly lastPlayedAt = new Map<string, number>();
  /** Shared "โลกมีมิติ" seam (W2), supplied by GameRenderer. When absent (e.g. a
   *  bare test construction) ghosts keep today's flat pivot-0 / y-0 placement. */
  private readonly worldFx: WorldFxContext | null;

  constructor(parent: Container, opts?: { worldFx?: WorldFxContext }) {
    this.container = new Container();
    // Depth-sort ghosts among themselves when the depth flag is on; off → every
    // ghost gets the same neutral zIndex → stable sort keeps insertion order.
    this.container.sortableChildren = true;
    this.worldFx = opts?.worldFx ?? null;
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
        // Foot-pivot so depth scale/terrain lift plant the feet on the ground
        // (paired with `view.y = footY` below); only when the seam is present so
        // a bare-construction ghost stays byte-identical to today.
        if (this.worldFx) view.pivot.y = GROUND_Y;
        this.views.set(item.cid, view);
        this.container.addChild(view);
      }
      // slot !== 0 shows the white nameplate (the existing display-name seam). `events: []`
      // stays empty — a pose is NEVER driven through a synthesized engine event; the R3
      // pulse below is a rig-only entry point (see `playHeroPosePulse`).
      updateHeroView(view, stub(item), {
        dt,
        slot: 1,
        events: [],
        marching: false,
        displayName: item.name || null,
        socialBadge: null,
      });
      // R3 action stream: edge-trigger a one-shot pose when the peer's action counter
      // ADVANCES (walk/idle map to no pulse). Fired AFTER `updateHeroView` so the rig is
      // built (`cls` set) — the pose then plays from the next frame's `resolveAttack` and
      // decays back to walk/idle on its own. `p`-only ghosts (no `at`) never enter here.
      if (item.at !== undefined) {
        const last = this.lastPlayedAt.get(item.cid);
        if (last === undefined || item.at > last) {
          this.lastPlayedAt.set(item.cid, item.at);
          const pose = actionToPose(item.action);
          if (pose) playHeroPosePulse(view, pose);
        }
      }
      // Ghosts show no combat readout: hide the HP bar the rig draws for real heroes.
      view.hpBar.visible = false;
      // Whole-rig fade (in on appear, out before prune) — container alpha multiplies
      // through every child incl. the nameplate.
      view.alpha = item.alpha;
      // Depth placement (hash(cid) row): plant feet at the lifted ground, scale
      // by depth, sort near-over-far. OFF-identity: footY≡GROUND_Y (cancels the
      // pivot), depthScaleOf≡1, equal neutral zIndex → insertion order.
      if (this.worldFx) {
        // A ghost has no live engine entity, so place it off the engine's shared
        // scatter math (`scatterPlaneY(cid)`) — the seam inverts that back to the
        // ghost's stable depth row (bit-exact), the same engine-owned depth source
        // every other actor resolves through (R4 Wave C0).
        const d = this.worldFx.depthOf("ghost", item.cid, undefined, undefined, scatterPlaneY(item.cid));
        view.y = this.worldFx.footY(item.x, d);
        view.scale.set(this.worldFx.depthScaleOf(d));
        view.zIndex = depthZIndex(d);
      }
    }
    // Sweep ghosts that vanished from the list.
    for (const [cid, view] of this.views) {
      if (!seen.has(cid)) {
        this.container.removeChild(view);
        view.destroy({ children: true });
        this.views.delete(cid);
        this.lastPlayedAt.delete(cid);
      }
    }
  }

  /** Read-only pooled-view accessor (renderer diagnostics / headless tests) — lets a caller
   *  inspect a ghost's rig state without a reference to the private pool. */
  viewFor(cid: string): HeroView | undefined {
    return this.views.get(cid);
  }

  /** Full teardown (renderer destroy / StrictMode unmount). */
  destroy(): void {
    for (const view of this.views.values()) {
      this.container.removeChild(view);
      view.destroy({ children: true });
    }
    this.views.clear();
    this.lastPlayedAt.clear();
    this.container.destroy({ children: true });
  }
}
