/**
 * Per-entity depth assignment for the promoted "โลกมีมิติ" depth band — pure
 * math, NO Pixi/DOM (same leaf-module contract as `depthBand`/`terrain`, so it
 * stays a provable game-side import that never drags the render layer).
 *
 * `depthBand.ts` maps a depth coordinate d ∈ [0,1] to screen effects; THIS
 * module decides which d each actor gets so the band reads as a stable stage:
 *   - heroes: solo stands at a fixed downstage row; a party fans its members
 *     evenly across a mid band by slot order (lockstep slot = draw order);
 *   - enemies: hash(id) scatters them across the FULL band (a crowd has real
 *     front/back rows, deterministic per spawn id — no RNG draw, footgun-safe);
 *   - ghosts: hash(cid) — the same stable scatter keyed on the ghost's charId.
 *
 * `hashUnit` is a 32-bit FNV-1a folded into [0,1): stable across runs/among
 * clients (no Math.random), so two players computing enemyDepth(id) agree.
 */

// ---------------------------------------------------------------------------
// Knobs — the hero rows within the band.
// ---------------------------------------------------------------------------

/** Depth a solo hero always stands at (downstage-ish, front of the field). */
export const HERO_SOLO_DEPTH = 0.65;
/** Party members fan evenly across [MIN, MAX] by slot order (slot 0 = far). */
export const HERO_BAND_MIN = 0.45;
export const HERO_BAND_MAX = 0.85;

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

// ---------------------------------------------------------------------------
// Per-kind depth
// ---------------------------------------------------------------------------

/** Clamp a slot index into [0, partySize-1] so a stray slot never leaves the band. */
function clampSlot(slot: number, partySize: number): number {
  return Math.max(0, Math.min(partySize - 1, Math.floor(slot)));
}

/**
 * Depth for a hero at lockstep `slot` in a party of `partySize`.
 *   - solo (partySize ≤ 1) → HERO_SOLO_DEPTH (a single fixed row);
 *   - party → evenly spread over [HERO_BAND_MIN, HERO_BAND_MAX] by slot order,
 *     endpoints inclusive (slot 0 = far edge, last slot = near edge).
 */
export function heroDepth(slot: number, partySize: number): number {
  if (partySize <= 1) return HERO_SOLO_DEPTH;
  const s = clampSlot(slot, partySize);
  const t = s / (partySize - 1);
  return HERO_BAND_MIN + (HERO_BAND_MAX - HERO_BAND_MIN) * t;
}

/** Depth for an enemy — hash(id) across the full [0,1) band (real crowd rows). */
export function enemyDepth(id: number): number {
  return hashUnit(id);
}

/** Depth for a ghost — hash(charId) across the full [0,1) band. */
export function ghostDepth(cid: string): number {
  return hashUnit(cid);
}
