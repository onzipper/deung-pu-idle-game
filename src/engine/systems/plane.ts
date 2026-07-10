/**
 * Deterministic depth-PLANE / y assignment (R4 Wave A "engine-owned deterministic y at spawn").
 *
 * PURPOSE. Ports the SEMANTICS of `render/worldDepth/depthAssign` + `depthBand` INTO the
 * engine so the simulation core becomes the single source of truth for each entity's
 * ground-plane depth row. The value is the world-y OFFSET (relative to the ground line,
 * 0 = on the line) an entity sits at for its depth — numerically identical to what
 * `depthBand.depthOffsetY(d)` produces today — so the coming Wave-B render cutover can READ
 * `entity.planeY` in place of recomputing its own depth, and the R4-R5 true x/y movement
 * milestone has a real y axis to move entities along.
 *
 * PROVENANCE (engine must NOT import render — ESLint boundary rule). `hashUnit`, the far/near
 * band, and the hero solo/party rows are DUPLICATED from
 * `src/render/worldDepth/{depthAssign,depthBand}.ts`. They are kept numerically in lock-step
 * via `CONFIG.plane` (bandFar/bandNear ≡ DEPTH_OFFSET_FAR/NEAR; formationDepth ≡
 * HERO_SOLO_DEPTH; heroBandMin/Max ≡ HERO_BAND_MIN/MAX). A parity test pins the two together.
 *
 * DETERMINISM. Pure — a STATELESS FNV-1a hash of the entity id (numbers are stringified, so
 * `hashUnit(3) === hashUnit("3")`), NEVER the seeded wave-composition RNG stream (reserved;
 * CLAUDE.md) and NEVER a wall-clock. Same id → same `planeY` on every client, so it is
 * lockstep-safe by construction (and folded into `stateHash` as a divergence canary).
 *
 * WAVE A SCOPE. `planeY` is assigned ONCE at spawn and is UNUSED by combat/movement/targeting
 * and by render placement this wave (render keeps computing its own depth; combat stays
 * x-based on the ground line). It is new deterministic sim state only — behaviour-neutral.
 * Movement across the plane (easing at `CONFIG.plane.ySpeed`) arrives with the R4-R5 milestone.
 */

import { CONFIG } from "@/engine/config";
import { clamp, lerp } from "@/engine/core/math";
import type { HeroClass } from "@/engine/entities";

// FNV-1a 32-bit offset basis / prime — ported VERBATIM from
// render/worldDepth/depthAssign.ts `hashUnit` (do not diverge; parity-tested).
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Deterministic hash of a string/number → [0,1). FNV-1a over the UTF-16 code units of the
 * key (numbers stringified first, so `hashUnit(3) === hashUnit("3")`), folded to unsigned
 * 32-bit and divided by 2^32. Pure — no `Math.random`, no wall-clock, never the wave RNG.
 * Byte-identical to the render layer's `hashUnit`, so an engine-assigned `planeY` reproduces
 * the render depth every client would otherwise compute.
 */
export function hashUnit(key: string | number): number {
  const s = typeof key === "number" ? String(key) : key;
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  // `>>> 0` = interpret the 32-bit pattern as unsigned before scaling into [0,1).
  return (h >>> 0) / 4294967296;
}

/**
 * World-y offset for a depth `d ∈ [0,1]` — lerp bandFar→bandNear, strictly increasing in `d`
 * (0 = far/upstage, raised toward the horizon; 1 = near/downstage, dropped toward the camera).
 * The engine mirror of `depthBand.depthOffsetY`; monotonic so the plane never "folds".
 */
export function planeYForDepth(d: number): number {
  const P = CONFIG.plane;
  return lerp(P.bandFar, P.bandNear, clamp(d, 0, 1));
}

/**
 * Enemy (incl. asura elite + boss-summoned add) depth row: a stable per-id scatter across the
 * FULL band, so a crowd reads with real front/back rows. Mirror of `depthAssign.enemyDepth`
 * → `depthOffsetY`. Deterministic per spawn id (no RNG draw), so every client agrees.
 */
export function enemyPlaneY(id: number): number {
  return planeYForDepth(hashUnit(id));
}

/**
 * Stable per-key scatter row (mirror of `depthAssign.ghostDepth` → `depthOffsetY`): the
 * engine helper for ghosts and town NPCs, which are render/CONFIG-anchor concepts with NO
 * live engine entity to write `planeY` onto. Exposed so Wave-B render places them off the
 * engine's plane math instead of its own.
 */
export function scatterPlaneY(key: string | number): number {
  return planeYForDepth(hashUnit(key));
}

/**
 * Hero depth row (mirror of `depthAssign.heroDepth` → `depthOffsetY`): a SOLO hero stands on
 * its class FORMATION row (`formationDepth[cls]` — all four classes equal today, so this
 * reproduces render's single solo depth exactly; kept PER-CLASS as the R4-R5 hook to spread
 * classes onto distinct rows later). A party FANS evenly across [heroBandMin, heroBandMax] by
 * lockstep `slot` order (slot 0 = far edge, last slot = near edge). Pure — `slot`/`partySize`
 * are lockstep state (array order / `heroes.length`), so all cohort clients agree.
 */
export function heroPlaneY(cls: HeroClass, slot = 0, partySize = 1): number {
  const P = CONFIG.plane;
  if (partySize <= 1) return planeYForDepth(P.formationDepth[cls]);
  const s = Math.max(0, Math.min(partySize - 1, Math.floor(slot)));
  const t = s / (partySize - 1);
  return planeYForDepth(lerp(P.heroBandMin, P.heroBandMax, t));
}

/**
 * Boss depth row: a boss stands DOWNSTAGE on the NEAR edge (a single fixed row, no id scatter)
 * — render already draws bosses frontmost (zIndex +10000), so the near row matches that read.
 */
export function bossPlaneY(): number {
  return planeYForDepth(1);
}
