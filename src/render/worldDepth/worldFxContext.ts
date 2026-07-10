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
import { createTerrain, type Terrain } from "./terrain";
import { terrainForZone } from "./terrainZone";
import { hashUnit, type Zone } from "@/engine";

/**
 * Invert `planeY` (a world-y OFFSET, the output of the engine's `planeYForDepth`
 * / render's `depthOffsetY`) back to its depth d ∈ [0,1]. Bit-exact round-trip
 * of `depthOffsetY` for every hash/party/solo value the engine produces (the
 * band width 64 is a power of two, so the lerp is losslessly invertible —
 * verified exhaustively), so `depthOffsetY(planeToDepth(planeY)) === planeY` and
 * `depthScale`/`depthZIndex` reproduce the pre-cutover render-owned values
 * EXACTLY. This is THE depth source at the seam (R4 Wave C0): engine `planeY`
 * flows through the SAME footY/scale/zIndex pipeline, no dual path.
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
  /** Turn depth / terrain effects on or off (both default OFF = today). */
  setFlags(f: { depth: boolean; terrain: boolean }): void;
  /**
   * Whether the depth band is currently ON. THE single source of truth a
   * consumer that lives in the shared actor container (`GhostLayer` since R4.5
   * Wave 1.2 #69) branches its sort-key on: depth ON → `depthZIndex(d)` (near
   * over far, interleaving with heroes/enemies); depth OFF → a fixed backmost
   * key that keeps ghosts behind every local actor (the pre-#69 "ghosts under
   * my party" z-order, now that they no longer live in a separate below-
   * `entities` container). Mirrors `depthOf`'s own `depthOn` branch so the two
   * can never disagree.
   */
  depthEnabled(): boolean;
  /** Bind the current zone's terrain (null → flat). Cached: zero re-alloc. */
  setZone(zone: Zone | null): void;
  /** Ground line y at world x (terrain flag ? zone terrain : GROUND_Y). */
  groundY(x: number): number;
  /**
   * Depth d for an actor (depth flag off → DEPTH_NEUTRAL). Depth is engine-owned
   * (R4 Wave C0): the caller supplies the entity's engine `planeY` (Hero/Enemy
   * carry it; ghosts pass `scatterPlaneY(cid)`) and d is inverted from it via
   * `planeToDepth`. `planeY` null/omitted is a defensive case only — after
   * Wave A/B every live actor is stamped — and degrades to a stable id-hash row
   * (`hashUnit(id)`, the value the engine's own scatter inverts to), NOT the flat
   * neutral line, so a stray actor still gets a plausible depth. `kind`/`slot`/
   * `partySize` are retained for the call shape (unused now the hash-assignment
   * path is retired; Wave C1 may reintroduce per-slot logic).
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
  let terrain: Terrain = FLAT_TERRAIN;

  const groundY = (x: number): number => (terrainOn ? terrain.groundY(x) : GROUND_Y);

  return {
    setFlags(f) {
      depthOn = f.depth;
      terrainOn = f.terrain;
    },
    depthEnabled() {
      return depthOn;
    },
    setZone(zone) {
      terrain = zone ? terrainForZone(zone) : FLAT_TERRAIN;
    },
    groundY,
    depthOf(kind, id, slot, partySize, planeY) {
      if (!depthOn) return DEPTH_NEUTRAL;
      // Depth is engine-owned (R4 Wave C0): invert the entity's engine `planeY`.
      // `planeToDepth` is a bit-exact inverse of the plane offset, so footY/scale/
      // zIndex reproduce the pre-cutover values EXACTLY.
      if (planeY != null) return planeToDepth(planeY);
      // Defensive fallback — should not happen post-Wave-A (every live Hero/Enemy/
      // Boss + party hero is stamped). A stray actor with no engine row degrades to
      // a stable id-hash scatter (the same value the engine's enemyPlaneY/
      // scatterPlaneY invert to) rather than snapping to the flat neutral line.
      return hashUnit(id);
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
