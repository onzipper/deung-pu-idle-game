/**
 * WALKABLE AREA v1 (free-field 2.5D, `docs/world-arc-freefield-v1.md` §3, phase 5).
 *
 * PURPOSE. Generalizes the v0 walkable area (the full per-map `fieldRect`) into an OPTIONAL
 * per-map walkable OUTLINE: one simple polygon in FIELD coordinates (x in field units, y in
 * band units [`plane.bandFar`, `plane.bandNear`]). A map WITHOUT an outline stays a full field
 * rect — today's behaviour, byte-identical (see the fallback below). No shipped map defines an
 * outline in this slice (full-rect everywhere); the machinery is proven via test fixtures, and a
 * real shaped field is a later owner/design decision.
 *
 * THE CONTRACT. `clampToWalkable(mapId, x, y)` resolves ANY target to the nearest REACHABLE
 * point — inside ⇒ identity, outside ⇒ the nearest point on the outline boundary. This is the
 * "never fail silently" guarantee: render sends a raw tap, the engine fixes it up. Intake clamps
 * (manual `moveTo`, town walk via that command, ninja dash landing) route through here; the
 * per-step combat x-clamp deliberately does NOT (no per-step polygon test on the hot path — a
 * convex-ish outline with clamped endpoints keeps the straight-line move inside for practical
 * shapes; a concave cut-through is an ACCEPTED v1 limitation, "stop at boundary is acceptable"
 * per spec, refined in v2/v3).
 *
 * DETERMINISM (CLAUDE.md). Pure `(mapId, x, y) → {x, y}`: ray-cast inside-test + point-to-segment
 * projection over the outline edges — ONLY +, −, ×, ÷, and `clamp` (all IEEE-correctly-rounded,
 * so bit-identical on V8/JSC/SpiderMonkey). NO transcendental (SQUARED distances compare edges, so
 * no `sqrt`/dmath needed), NO seeded-RNG draw (reserved for wave composition), NO wall-clock. Ties
 * resolve deterministically: edges scan in outline order and the FIRST edge wins on an exact
 * distance tie (strict `<`), so every lockstep client agrees.
 *
 * NOT x-only. `y` is a first-class field axis here (do not bake in 1D assumptions — the R5 combat
 * flip reads true 2D distance). This module owns geometry only; it never gates combat.
 */

import { CONFIG } from "@/engine/config";
import { clamp } from "@/engine/core/math";
import { fieldRect } from "@/engine/systems/plane";

/** A field-space point (x in field units, y in band units). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A per-map walkable OUTLINE (v1): one simple polygon, vertices in field coordinates, listed in
 * order (winding-agnostic — the inside-test is a ray cast). Absent ⇒ the full field rect. A
 * degenerate outline (< 3 vertices) is treated as ABSENT so it can never silently trap the hero.
 */
export type WalkablePolygon = readonly Point[];

/**
 * Structural view of a map-config entry that MAY carry a walkable outline. `CONFIG.world.maps` is
 * an `as const` literal and NO shipped map defines `walkable` (full-rect everywhere — the fallback
 * stays byte-identical), so we read the optional property through this view rather than widening
 * the frozen literal type. A future authored map — or a test fixture — sets `walkable` as pure data.
 */
interface MaybeWalkableMap {
  readonly id: string;
  readonly walkable?: WalkablePolygon;
}

/**
 * The walkable outline for `mapId`, or `undefined` when the map has none (⇒ full field rect).
 * A degenerate outline (< 3 vertices) also returns `undefined` (fail safe → rect, never a trap).
 */
export function walkablePolygon(mapId: string): WalkablePolygon | undefined {
  const map = CONFIG.world.maps.find((m) => m.id === mapId) as MaybeWalkableMap | undefined;
  const poly = map?.walkable;
  return poly && poly.length >= 3 ? poly : undefined;
}

/**
 * Ray-cast (crossing-number) inside test for a simple polygon. Pure — only comparisons and one
 * IEEE division per edge. A point exactly ON the boundary may report either way; that is HARMLESS
 * here because `clampToPolygon` projects a "not inside" boundary point to distance 0 (itself), so
 * the resolver is identity on the boundary regardless of the parity verdict.
 */
function pointInPolygon(poly: WalkablePolygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    // Edge straddles the horizontal ray through (x, y), and the crossing is to the right of x.
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Nearest point on the segment a→b to p, with its SQUARED distance (no `sqrt` — squared distance
 * orders edges identically and stays fully deterministic). `t` (the projection parameter) is
 * clamped to [0,1] so the nearest point is an endpoint when the foot of the perpendicular falls
 * outside the segment. A zero-length edge projects to a (its `d2` still competes correctly).
 */
function projectToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; d2: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / ab2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx, y: cy, d2: dx * dx + dy * dy };
}

/**
 * Clamp (x, y) into a walkable polygon: inside ⇒ identity, outside ⇒ the nearest point on the
 * polygon BOUNDARY (nearest projection over all edges, first-edge-wins on an exact tie). Pure /
 * deterministic. Exposed for direct unit-testing of the geometry without a config round-trip.
 */
export function clampToPolygon(poly: WalkablePolygon, x: number, y: number): Point {
  if (pointInPolygon(poly, x, y)) return { x, y };
  let best: { x: number; y: number; d2: number } | null = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = projectToSegment(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
    if (best === null || c.d2 < best.d2) best = c;
  }
  return best ? { x: best.x, y: best.y } : { x, y };
}

/**
 * THE resolver every field intake routes through. When `mapId` defines a walkable outline the
 * target resolves to the nearest reachable point on/inside it; otherwise it falls back to the
 * per-map `fieldRect` — an INDEPENDENT x/y clamp that is BIT-IDENTICAL to the pre-phase-5 intake
 * clamp (pinned by test), so a map with no outline behaves exactly as today.
 */
export function clampToWalkable(mapId: string, x: number, y: number): Point {
  const poly = walkablePolygon(mapId);
  if (poly) return clampToPolygon(poly, x, y);
  const f = fieldRect(mapId);
  return { x: clamp(x, f.minX, f.maxX), y: clamp(y, f.minY, f.maxY) };
}
