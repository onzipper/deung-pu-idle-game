/**
 * Shared stable string/number → [0,1) hash for the "โลกมีมิติ" world-fx layer —
 * pure math, NO Pixi/DOM (same leaf-module contract as `depthBand`/`terrain`, so
 * it stays a provable game-side import that never drags the render layer).
 *
 * As of R4 Wave C0 the per-entity depth ASSIGNMENT (heroDepth/enemyDepth/
 * ghostDepth) is retired — depth is engine-owned (`Entity.planeY`, read at the
 * `worldFxContext` seam). What remains here is the underlying deterministic hash
 * that the surviving render-side consumers still need:
 *   - `terrainZone.ts` — pick a terrain preset per (mapId, zoneIdx);
 *   - `weatherSchedule.ts` — pick a weather kind per (zone, time-window);
 *   - `worldFxContext.depthOf` — the defensive no-`planeY` fallback row.
 *
 * `hashUnit` is a 32-bit FNV-1a folded into [0,1): stable across runs/among
 * clients (no Math.random) and byte-identical to the engine's own `hashUnit`
 * (`systems/plane.ts`, parity-tested), so the two agree on every key.
 */

// ---------------------------------------------------------------------------
// Stable hash → unit interval
// ---------------------------------------------------------------------------

/** FNV-1a offset basis / prime (32-bit). */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Deterministic hash of a string/number → [0,1). FNV-1a over the UTF-16 code
 * units (numbers are stringified first, so `hashUnit(3) === hashUnit("3")`),
 * folded to unsigned 32-bit and divided by 2^32. Pure — the ONLY randomness
 * source the depth/weather layers use, and it never touches the engine RNG.
 */
export function hashUnit(key: string | number): number {
  const s = typeof key === "number" ? String(key) : key;
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  // `>>> 0` = interpret the 32-bit pattern as unsigned before scaling.
  return (h >>> 0) / 4294967296;
}
