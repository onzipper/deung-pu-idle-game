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
 * band, and the hero solo/party rows were PORTED from the render depth layer. The band math
 * still lives in `src/render/worldDepth/depthBand.ts` (kept numerically in lock-step via
 * `CONFIG.plane.bandFar/bandNear ≡ DEPTH_OFFSET_FAR/NEAR`; a parity test pins the two). The
 * per-actor row ASSIGNMENT it also mirrored (`render/worldDepth/depthAssign` heroDepth/enemyDepth/
 * ghostDepth + its HERO_* constants) was RETIRED at R4 Wave C0 — depth is now engine-owned — so
 * the hero-row knobs (formationDepth, heroBandMin/Max) are engine-only invariants with no render
 * twin (see git history for the retired depth-assignment source).
 *
 * DETERMINISM. Pure — a STATELESS FNV-1a hash of the entity id (numbers are stringified, so
 * `hashUnit(3) === hashUnit("3")`), NEVER the seeded wave-composition RNG stream (reserved;
 * CLAUDE.md) and NEVER a wall-clock. Same id → same `planeY` on every client, so it is
 * lockstep-safe by construction (and folded into `stateHash` as a divergence canary).
 *
 * WAVE A SCOPE. `planeY` was assigned ONCE at spawn and (Wave A) UNUSED by combat/movement/
 * targeting — new deterministic sim state only.
 *
 * WAVE C1 (hero y steering). Hero `planeY` becomes MUTABLE per step: `stepPlaneY` eases a hero
 * toward its engagement lane (an ENGAGED farm mob's `planeY`) or back to its home row (idle /
 * walking / boss & world-boss fights) at `CONFIG.plane.ySpeed`. Enemies/boss/worldBoss `planeY`
 * stay STATIC (owner-confirmed — only heroes move on the plane). The steering is COSMETIC by
 * construction: `planeY` is never read by targeting/range/cooldown/skills, so it can never gate
 * an attack (targeting stays x-only on the ground line). The wiring lives in `systems/combat.ts`
 * (the per-hero update); this module owns only the pure math helper.
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
 * FULL band, so a crowd reads with real front/back rows. Ported from the retired render depth-
 * assignment (see git history) → `depthOffsetY`. Deterministic per spawn id (no RNG draw), so
 * every client agrees. STATIC in C1 — enemies never steer their `planeY` (only heroes do).
 */
export function enemyPlaneY(id: number): number {
  return planeYForDepth(hashUnit(id));
}

/**
 * Stable per-key scatter row (ported from the retired render depth-assignment, see git history,
 * → `depthOffsetY`): the engine helper for ghosts and town NPCs, which are render/CONFIG-anchor concepts with NO
 * live engine entity to write `planeY` onto. Exposed so Wave-B render places them off the
 * engine's plane math instead of its own.
 */
export function scatterPlaneY(key: string | number): number {
  return planeYForDepth(hashUnit(key));
}

/**
 * Hero depth row (ported from the retired render depth-assignment, see git history, →
 * `depthOffsetY`): a SOLO hero stands on
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

/**
 * Ease `current` a hero's-depth-row `planeY` toward `target` by at most `ySpeed × dt` this step
 * (R4 Wave C1 hero y steering). Pure — only +, −, and `clamp` (float-determinism policy: no
 * transcendental, no wall-clock, no RNG), so it evolves bit-identically on every lockstep client.
 *
 * ARRIVE-EPS. Once the remaining gap is within `CONFIG.plane.yArriveEps` the step SNAPS to
 * `target` and holds — there is no sub-unit chatter/oscillation at arrival. (The clamp alone
 * already lands exactly on `target` the first step the gap drops under one `ySpeed × dt`, since
 * `clamp(delta,−m,m) === delta` there; the eps is a belt-and-suspenders guard against float
 * residue and documents the "no oscillation" intent.)
 *
 * COSMETIC. The caller (`systems/combat.updateHeroes`) runs this UNCONDITIONALLY after the
 * x-move / attack decision, and `planeY` is never read by targeting/range/cooldown/skills, so
 * steering can never gate an attack — the balance sim is unaffected by construction.
 */
export function stepPlaneY(current: number, target: number, dt: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= CONFIG.plane.yArriveEps) return target;
  const maxStep = CONFIG.plane.ySpeed * dt;
  return current + clamp(delta, -maxStep, maxStep);
}
