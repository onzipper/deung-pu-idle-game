/**
 * THE shared world-fx seam for the promoted "โลกมีมิติ" layer — pure math, NO
 * Pixi/DOM. One instance is owned by GameRenderer and handed to FxController /
 * ghost layer / hit-test so every consumer resolves the SAME ground line and
 * depth for a given (zone, x, entity), and a single flag flip turns the whole
 * world flat/depthless.
 *
 * Why a pure recompute and not "read the view's y": kill-time fx fire after the
 * dying entity's pooled view is already released, so there is no view to read —
 * the context recomputes footY/depth from the entity's world x + id instead.
 *
 * OFF-identity (both flags false) is bit-exact "today": groundY ≡ GROUND_Y,
 * footY ≡ GROUND_Y, depthScaleOf ≡ 1, and depthOf ≡ DEPTH_NEUTRAL (the row
 * whose depthOffsetY is exactly 0). All methods are zero-alloc after `setZone`
 * (terrainForZone is cached → same Terrain instance, no per-call allocation).
 */

import { GROUND_Y, WORLD_WIDTH } from "@/render/layout";
import {
  depthOffsetY,
  depthScale,
  DEPTH_OFFSET_FAR,
  DEPTH_OFFSET_NEAR,
} from "./depthBand";
import { heroDepth, enemyDepth, ghostDepth } from "./depthAssign";
import { createTerrain, type Terrain } from "./terrain";
import { terrainForZone } from "./terrainZone";
import type { Zone } from "@/engine";

/**
 * R4 Wave B flag: read the engine-owned `entity.planeY` (systems/plane.ts,
 * stamped at spawn/party-join) as the depth source instead of recomputing the
 * render-side hash. DEFAULT ON — the engine's plane math is a VERBATIM port of
 * `depthBand`/`depthAssign`, so the two are byte-identical (proven exhaustively
 * by `worldDepthEngineYIdentity.test.ts`). Flip to `false` to fall back to the
 * pre-cutover render-owned hash path; that path stays intact this wave.
 */
export const WORLD_DEPTH_FROM_ENGINE_Y = true;

/**
 * Invert `planeY` (a world-y OFFSET, the output of the engine's `planeYForDepth`
 * / render's `depthOffsetY`) back to its depth d ∈ [0,1]. Bit-exact round-trip
 * of `depthOffsetY` for every hash/party/solo value the engine produces (the
 * band width 64 is a power of two, so the lerp is losslessly invertible —
 * verified exhaustively), so `depthOffsetY(planeToDepth(planeY)) === planeY` and
 * `depthScale`/`depthZIndex` reproduce the render-owned path EXACTLY. This lets
 * the seam feed engine `planeY` through the SAME footY/scale/zIndex pipeline the
 * hash path uses, keeping the flag ON/OFF pixel-identical.
 */
export function planeToDepth(planeY: number): number {
  return (planeY - DEPTH_OFFSET_FAR) / (DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR);
}

/**
 * The depth d where depthOffsetY(d) === 0 (no vertical lift). depthOffsetY is
 * linear FAR→NEAR, so solve DEPTH_OFFSET_FAR + (NEAR−FAR)·d = 0. With the
 * shipped band knobs (−24, 40) this is 24/64 = 0.375 (pinned by test). Returned
 * by `depthOf` when the depth flag is OFF so any consumer that (wrongly) feeds
 * it back through depthOffsetY still gets 0.
 */
export const DEPTH_NEUTRAL = -DEPTH_OFFSET_FAR / (DEPTH_OFFSET_NEAR - DEPTH_OFFSET_FAR);

export type WorldFxKind = "hero" | "enemy" | "ghost";

export interface WorldFxContext {
  /**
   * Turn depth / terrain effects on or off (both default OFF = today). `engineY`
   * (R4 Wave B) selects the engine-owned `planeY` cutover; omitted → the module
   * default `WORLD_DEPTH_FROM_ENGINE_Y` (ON), so existing `{depth,terrain}`
   * callers get the cutover for free while keeping the OFF path selectable.
   */
  setFlags(f: { depth: boolean; terrain: boolean; engineY?: boolean }): void;
  /** Bind the current zone's terrain (null → flat). Cached: zero re-alloc. */
  setZone(zone: Zone | null): void;
  /** Ground line y at world x (terrain flag ? zone terrain : GROUND_Y). */
  groundY(x: number): number;
  /**
   * Depth d for an actor (depth flag ? assigned : DEPTH_NEUTRAL). When the
   * `engineY` flag is on AND a live `planeY` is supplied (Hero/Enemy carry it;
   * ghosts pass `scatterPlaneY(cid)`), d is inverted from that engine value
   * instead of recomputed here — the R4 Wave B cutover. `planeY` null/omitted
   * (an entity without one) falls back to the render-owned hash path.
   */
  depthOf(
    kind: WorldFxKind,
    id: number | string,
    slot?: number,
    partySize?: number,
    planeY?: number | null,
  ): number;
  /** On-screen foot y at x for depth d (groundY + depth lift; flag off → groundY). */
  footY(x: number, d: number): number;
  /** Uniform render scale for depth d (flag off → 1). */
  depthScaleOf(d: number): number;
  /** Terrain lift at x vs the flat baseline: groundY(x) − GROUND_Y (flag off → 0). */
  lift(x: number): number;
}

/** Shared flat terrain for the null-zone / flag-off path (groundY ≡ GROUND_Y). */
const FLAT_TERRAIN: Terrain = createTerrain("flat", WORLD_WIDTH);

export function createWorldFxContext(): WorldFxContext {
  let depthOn = false;
  let terrainOn = false;
  let engineYOn = WORLD_DEPTH_FROM_ENGINE_Y;
  let terrain: Terrain = FLAT_TERRAIN;

  const groundY = (x: number): number => (terrainOn ? terrain.groundY(x) : GROUND_Y);

  return {
    setFlags(f) {
      depthOn = f.depth;
      terrainOn = f.terrain;
      engineYOn = f.engineY ?? WORLD_DEPTH_FROM_ENGINE_Y;
    },
    setZone(zone) {
      terrain = zone ? terrainForZone(zone) : FLAT_TERRAIN;
    },
    groundY,
    depthOf(kind, id, slot, partySize, planeY) {
      if (!depthOn) return DEPTH_NEUTRAL;
      // R4 Wave B: read the engine-owned plane row when present. `planeToDepth`
      // is a bit-exact inverse, so this is pixel-identical to the hash path
      // below for every value the engine stamps (Hero/Enemy `planeY`, ghost
      // `scatterPlaneY(cid)`) — flag ON === flag OFF.
      if (engineYOn && planeY != null) return planeToDepth(planeY);
      if (kind === "hero") return heroDepth(slot ?? 0, partySize ?? 1);
      if (kind === "ghost") return ghostDepth(typeof id === "string" ? id : String(id));
      return enemyDepth(typeof id === "number" ? id : Number(id));
    },
    footY(x, d) {
      return depthOn ? groundY(x) + depthOffsetY(d) : groundY(x);
    },
    depthScaleOf(d) {
      return depthOn ? depthScale(d) : 1;
    },
    lift(x) {
      return groundY(x) - GROUND_Y;
    },
  };
}
