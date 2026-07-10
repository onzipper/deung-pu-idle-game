/**
 * DASH PRIMITIVE (นินจา / Ninja, SAVE v18 — docs/ninja-design.md §1).
 *
 * A deterministic hero REPOSITION: the ninja blinks to land adjacent to a target so its
 * short-range dagger (the shortest reach in the game) can strike after the leap. Shared by
 * the ninja skills that reposition — เงาพริบ (single blink), เงาสังหาร (chain of blinks),
 * พันเงานิรันดร์ (blink to the enemy centroid).
 *
 * DETERMINISM (CLAUDE.md): the landing is a PURE function of `(hero.x, targetX, config)` —
 * NO seeded-RNG draw (the stream is reserved for wave composition; combat/skills must never
 * draw from it), NO wall-clock. The hero's `x` is a transient runtime field, so a dash makes
 * NO save-shape change. Each dash emits a `heroDashed {heroId, fromX, toX}` event for the
 * render afterimage (one-way, engine never reads it back).
 */

import { CONFIG } from "@/engine/config";
import { clamp } from "@/engine/core/math";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** The current zone's walkable right edge (mirrors combat.ts `fieldMaxX` — the dash lands
 *  on the field, never off-screen). Kept local so dash stays a standalone primitive. */
function fieldMaxX(state: GameState): number {
  const map = CONFIG.world.maps.find((m) => m.id === state.location.mapId);
  return map?.fieldWidth ?? 900;
}

/**
 * Blink `hero` to land adjacent to a target at world-x `targetX`, on the FAR side (dash
 * "through" it — `CONFIG.ninja.dashLandGap` past the target, inside the dagger reach so the
 * follow-up strike connects). `maxReach` caps the hop distance: a short blink for เงาพริบ
 * (`CONFIG.ninja.dashMaxReach`), `Infinity` for the field-wide chain / ultimate. The landing
 * is clamped to the walkable field bounds. Emits `heroDashed` and returns the landing x.
 *
 * Pure/deterministic (only +,-,clamp; no RNG, no wall-clock). Safe when `fromX === targetX`
 * (lands `dashLandGap` to one side) and when the hop clamps to 0 (still emits, fromX === toX
 * — render simply draws a zero-length trail).
 */
export function dashHeroTo(
  state: GameState,
  hero: Hero,
  targetX: number,
  maxReach: number = Infinity,
  targetPlaneY?: number,
): number {
  const nj = CONFIG.ninja;
  const hunt = CONFIG.hunt;
  const fromX = hero.x;
  // Land on the far side of the target (blink through), so a follow-up strike sits in range.
  const fromLeft = fromX <= targetX;
  const desired = targetX + (fromLeft ? nj.dashLandGap : -nj.dashLandGap);
  // Cap the hop (short blink for skill 1; unbounded for the field-wide chain/ult).
  const hop = clamp(desired - fromX, -maxReach, maxReach);
  // Keep the landing on the walkable field (never blink off-screen or into the spawn edge).
  const toX = clamp(fromX + hop, hunt.heroMinX, fieldMaxX(state) - hunt.fieldRightMargin);

  hero.x = toX;
  // R4 Wave C2 — OPTIONAL depth-row landing. The CALLER passes the target's `planeY` ONLY
  // when the dash target is a `state.enemies` member (see `enemyDashPlaneY`); a boss /
  // world-boss / synthetic-x target passes nothing, so the hero's `planeY` is UNCHANGED
  // (C1 rule: never adopt the boss lane — bosses render on the static neutral path). When
  // present it is CLAMPED to the band (owner reminder #1: never trust the caller) and only
  // written when the hero actually has a `planeY` (hand-built literals may omit it). Purely
  // cosmetic — planeY gates no combat. The x math above is UNCHANGED (byte-identical dash x).
  if (
    typeof targetPlaneY === "number" &&
    Number.isFinite(targetPlaneY) &&
    typeof hero.planeY === "number"
  ) {
    hero.planeY = clamp(targetPlaneY, CONFIG.plane.bandFar, CONFIG.plane.bandNear);
  }
  state.events.push({ type: "heroDashed", heroId: hero.id, fromX, toX });
  return toX;
}

/**
 * The depth-row a dash should LAND on for a `target`, or `undefined` when it must NOT change
 * the hero's row. Returns the enemy's own `planeY` iff `target` is a live `state.enemies`
 * member with a numeric row — a BOSS / world-boss (not in `state.enemies`) or a plane-less
 * mob returns `undefined`, so `dashHeroTo` leaves `planeY` untouched (C1 "never adopt boss
 * lane"). Pure lookup by id; no RNG, no wall-clock. Used by the ninja dash skill call sites.
 */
export function enemyDashPlaneY(state: GameState, target: { id: number }): number | undefined {
  const e = state.enemies.find((m) => m.id === target.id);
  return e && typeof e.planeY === "number" ? e.planeY : undefined;
}
