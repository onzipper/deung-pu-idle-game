/**
 * FREE-FIELD (Phase 6) — world props that join the SHARED actor sort domain.
 *
 * Old Wave-3 "occlusion" concept, rebuilt on the free-field substrate: a world
 * prop is a build-once `Container` with a FOOT POSITION on the ground plane
 * (`x`, `planeY` in band units), placed through the SAME `worldFx` seam actors
 * use — `depthOf(planeY)` → `footY` / `depthScaleOf` / `depthZIndex`. Because
 * the prop views live INSIDE `GameRenderer`'s sortable `entities` container (as
 * siblings of hero/enemy/ghost roots), an actor whose feet are LOWER on screen
 * (nearer) draws IN FRONT of a prop, and a farther actor draws BEHIND it —
 * exactly the actor↔actor interleave from Wave 1.2, now including static props.
 *
 * Combat feedback is protected BY CONSTRUCTION, not by prop z-tuning:
 *   - damage numbers / tap markers live in the `fx` layer and the boss plate in
 *     the `overlay` layer — BOTH sit ABOVE `entities` in the layer stack, so a
 *     prop's zIndex (which only sorts WITHIN `entities`) can never occlude them;
 *   - an actor's own HP bar rides INSIDE its root, so "the HP bar sorts vs a
 *     prop" is identical to the actor-vs-prop foot interleave above;
 *   - props are non-tappable because every hit-test scans engine/renderer actor
 *     lists (`state.enemies`/`worldBoss`/`TOWN_NPCS`/`ghostList`) — a prop is in
 *     NONE of them, so it can never be a tap target regardless of its container.
 *
 * Static by design: placement is (re)applied only on a zone change or a depth-
 * flag flip — never per frame (zero steady-state alloc / sort churn). Pooled by
 * scene: `setZone` rebuilds geometry when the zone identity changes and destroys
 * the previous zone's props (no orphans across zone swaps).
 *
 * PLACEHOLDER art only (Phase 6 is the mechanism, not a visual pass): a single
 * flat-alpha stump/stone silhouette from the existing prop vocabulary. Real
 * per-area props wait on each area's owner-approved reference.
 */

import { Container, Graphics } from "pixi.js";
import type { Zone } from "@/engine";
import { GROUND_Y } from "@/render/layout";
import { depthZIndex } from "@/render/worldDepth/depthBand";
import type { WorldFxContext } from "@/render/worldDepth/worldFxContext";
import { safeRadius } from "@/render/theme";

/**
 * The fixed, strongly-backmost zIndex a prop takes when the depth band is OFF
 * (mirrors `GhostLayer`'s `GHOST_FLAT_ZINDEX = -11000` pattern). Props live in
 * the shared `entities` container, so their sort key is meaningful against local
 * actors even with depth off. This value sits BELOW every flag-off actor key —
 * heroes/enemies `0`, town NPCs `-500`, world boss `-10000`, ghosts `-11000` —
 * so a flat world keeps props as pure backmost scenery behind every actor,
 * never disturbing the pre-existing flat z-order. With depth ON, a prop instead
 * takes `depthZIndex(d) ∈ [0,1000]` and interleaves with actors by foot row.
 */
export const FIELD_PROP_FLAT_ZINDEX = -12000;

/**
 * One authored world prop: a foot position on the ground plane.
 * `blocker` is a DOCUMENTED HOOK for the engine-side walkable v2/v3 work
 * (free-field spec §3 "Walkable / blocked areas", Phase 5 owns the engine
 * read) — it is CURRENTLY UNREAD by render. Render only ever draws props; it
 * never subtracts a blocked shape from anything. Kept here so authored
 * placement can carry the radius alongside the visual without a later schema
 * churn; the engine will read it when walkable-v3 lands.
 */
export interface FieldPropSpec {
  /** World x on the field (engine units, `[0, WORLD_WIDTH]`). */
  x: number;
  /** Foot-row plane offset in band units (`[DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR]`);
   *  fed through `worldFx.depthOf` exactly like an actor's engine `planeY`. */
  planeY: number;
  /** UNREAD render-side (see interface doc) — engine walkable-v3 blocker radius. */
  blocker?: { r: number };
}

/**
 * Authored placeholder placement, PURE + deterministic (no `Math.random` — the
 * Wave-2C lesson: authored slots, never pure-hash randomness deciding design).
 * Farm zones get two placeholder props at distinct depth rows so the interleave
 * is provable and eye-testable; town/boss zones get none (kept clean). Same
 * two slots for every farm zone by design — trivial placeholder density, not a
 * per-zone visual composition.
 */
const FARM_PROP_SLOTS: readonly FieldPropSpec[] = [
  // Mid-band row — the row an actor most often shares, so passing in front of /
  // behind it is the obvious eye-test. Carries the (unread) blocker hook.
  { x: 300, planeY: -4, blocker: { r: 16 } },
  // A nearer (downstage) row so the two props themselves sit at different depths.
  { x: 640, planeY: 26 },
];

/** Deterministic authored prop specs for a zone (empty for non-farm zones). */
export function fieldPropSpecsFor(zone: Zone): readonly FieldPropSpec[] {
  return zone.kind === "farm" ? FARM_PROP_SLOTS : [];
}

/**
 * A single placeholder prop silhouette — a flat-alpha stump/stone from the
 * `groundProps.ts` vocabulary (layered flat fills, no gradient/filter/additive,
 * every radius `safeRadius`-clamped). Drawn in root-local space with its FOOT at
 * `y = GROUND_Y` (the root's pivot), body rising toward `-y`, so the shared
 * foot-plant transform (`view.y = footY`) lands it exactly on the ground — the
 * same convention as the hero/enemy rigs. Explicitly a placeholder.
 */
function buildPlaceholderProp(): Graphics {
  const g = new Graphics();
  const baseY = GROUND_Y;
  const H = 30;
  const halfW = 10;
  // Tapered trunk silhouette (flat mid tone).
  g.poly(
    [-halfW, baseY, -halfW + 2, baseY - H, halfW - 2, baseY - H, halfW, baseY],
    true,
  ).fill({ color: 0x5a4a38, alpha: 0.92 });
  // Darker shaded left face for a hint of form (flat alpha, not a gradient).
  g.poly(
    [-halfW, baseY, -halfW + 2, baseY - H, -halfW + 5, baseY - H, -halfW + 3, baseY],
    true,
  ).fill({ color: 0x3f3427, alpha: 0.9 });
  // Cut-top ellipse (the "stump" read).
  g.ellipse(0, baseY - H, safeRadius(halfW - 2), safeRadius(4)).fill({
    color: 0x6f5c45,
    alpha: 0.95,
  });
  return g;
}

interface LiveProp {
  view: Container;
  spec: FieldPropSpec;
}

/**
 * Hosts world props inside the shared `entities` sort domain. Constructed once
 * by `GameRenderer` with the same `worldFx` seam handed to `GhostLayer`; driven
 * by `setZone` every `draw()` (cheap identity-gated no-op in steady state).
 */
export class FieldProps {
  private readonly live: LiveProp[] = [];
  private curMapId: string | null = null;
  private curZoneIdx = -1;
  private curKind: string | null = null;
  private lastDepthOn: boolean | null = null;

  constructor(
    private readonly parent: Container,
    private readonly deps: { worldFx: WorldFxContext },
  ) {}

  /**
   * Bind the current zone. Rebuilds prop geometry ONLY when the zone identity
   * changes (destroying the prior zone's props — no orphans); (re)applies
   * placement when the zone OR the depth flag changed. A no-op in steady state
   * (same zone + same flag), with ZERO allocation on that path — the guard
   * compares zone fields directly instead of building a key string per frame.
   */
  setZone(zone: Zone): void {
    const depthOn = this.deps.worldFx.depthEnabled();
    const zoneChanged =
      zone.mapId !== this.curMapId ||
      zone.zoneIdx !== this.curZoneIdx ||
      zone.kind !== this.curKind;
    if (!zoneChanged && depthOn === this.lastDepthOn) return;

    if (zoneChanged) {
      this.rebuild(zone);
      this.curMapId = zone.mapId;
      this.curZoneIdx = zone.zoneIdx;
      this.curKind = zone.kind;
    }
    this.applyPlacement();
    this.lastDepthOn = depthOn;
  }

  /** Destroy the current zone's props and build the new zone's (build-once). */
  private rebuild(zone: Zone): void {
    for (const p of this.live) {
      this.parent.removeChild(p.view);
      p.view.destroy({ children: true });
    }
    this.live.length = 0;
    for (const spec of fieldPropSpecsFor(zone)) {
      const view = buildPlaceholderProp();
      // Foot pivot (like every actor root) so the foot-plant + depth scale grow
      // the prop around its feet on the ground — no re-added offset.
      view.pivot.y = GROUND_Y;
      this.parent.addChild(view);
      this.live.push({ view, spec });
    }
  }

  /**
   * (Re)apply each prop's foot-plant + depth scale + sort key for the CURRENT
   * depth-flag state, through the shared seam. `depthOf` with a finite `planeY`
   * ignores its `kind`/`id` args (the id-hash fallback is only for a missing
   * row), so passing `"enemy"` here is harmless — the returned d is exactly
   * `planeToDepth(planeY)` when depth is on, `DEPTH_NEUTRAL` when off (foot ≡
   * groundY, scale ≡ 1). Sort key mirrors `placeActor`/`GhostLayer`: depth ON →
   * `depthZIndex(d)` (shared domain); OFF → the fixed backmost flat key.
   */
  private applyPlacement(): void {
    const { worldFx } = this.deps;
    const depthOn = worldFx.depthEnabled();
    for (const { view, spec } of this.live) {
      const d = worldFx.depthOf("enemy", spec.x, undefined, undefined, spec.planeY);
      view.x = spec.x;
      view.y = worldFx.footY(spec.x, d);
      view.scale.set(worldFx.depthScaleOf(d));
      view.zIndex = depthOn ? depthZIndex(d) : FIELD_PROP_FLAT_ZINDEX;
    }
  }

  /** Live prop views (test/debug read only — never a hit-test source). */
  views(): readonly Container[] {
    return this.live.map((p) => p.view);
  }

  /** Full teardown (renderer destroy). */
  destroy(): void {
    for (const p of this.live) {
      this.parent.removeChild(p.view);
      p.view.destroy({ children: true });
    }
    this.live.length = 0;
    this.curMapId = null;
    this.curZoneIdx = -1;
    this.curKind = null;
    this.lastDepthOn = null;
  }
}
