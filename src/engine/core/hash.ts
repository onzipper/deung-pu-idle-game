/**
 * Stateless integer hashing (splitmix32) — the deterministic source for M7 drop
 * ROLLS.
 *
 * This is SEPARATE from the seeded RNG stream (`core/rng.ts`, mulberry32). That
 * stream is RESERVED for wave composition/placement; combat, skills, and drops
 * must NEVER draw from it (CLAUDE.md). Drops instead hash a persisted per-save
 * loot salt + monotonic counter, so a roll is a PURE function of `(salt,
 * counter)` — no carried state to desync, offline replay reproduces it exactly,
 * and rolling never perturbs the wave stream.
 */

/** splitmix32 finalizer: mixes a uint32 into a well-distributed uint32. */
export function splitmix32(seed: number): number {
  let x = (seed + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x;
}

/** Hash a (salt, counter) pair to a uint32. Order-independent of the RNG stream. */
export function lootHash(salt: number, counter: number): number {
  const mixed = ((salt >>> 0) ^ Math.imul(counter >>> 0, 0x9e3779b9)) >>> 0;
  return splitmix32(mixed);
}

/** Hash a (salt, counter) pair to a float in [0, 1). */
export function lootFloat(salt: number, counter: number): number {
  return lootHash(salt, counter) / 4294967296;
}
