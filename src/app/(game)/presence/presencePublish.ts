/**
 * Presence PUBLISH side (docs/ghost-presence-design.md §3.3, invariant #6). Pure sampling
 * of MY own hero into a wire snapshot — a one-way READ, never a command. Extracted here so
 * a test can assert the sampler mutates nothing (the "publisher only reads state" guard).
 *
 * `GameClient` runs the accumulator + change detection and hands the result to
 * `WorldSession.publish()`. Nothing about this round-trips: there is no "apply my own
 * snapshot" path anywhere.
 */

import type { HeroClass } from "@/engine";

/** The wire payload (≈80 bytes JSON, well under the relay's 256B cap). Cosmetic bits
 *  (aura/title/champ) are omitted in v1 — walk/idle-only ghosts don't need them yet. */
export interface PresenceSnapshot {
  v: 1;
  /** charId (server-derived, from the presence ticket) — the ghost's stable identity. */
  cid: string;
  /** displayName (server-derived, cosmetic-trust per design §4). */
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  /** World-x, rounded to int (sub-pixel precision is noise for a lerped ghost). */
  x: number;
  /** Monotonic sequence counter — receivers ignore stale/duplicate `t`. */
  t: number;
}

/** The minimal read-only view of my hero the sampler needs. */
export interface PublishableHero {
  x: number;
  cls: HeroClass;
  tier: 1 | 2 | 3;
}

/** The server-derived identity from the presence ticket. */
export interface PublishIdentity {
  charId: string;
  displayName: string;
}

/**
 * Build a snapshot of MY hero. PURE: reads `hero`/`identity`, returns a fresh object,
 * mutates nothing. `seq` is the caller's monotonic counter for this publish.
 */
export function buildPresenceSnapshot(
  hero: PublishableHero,
  identity: PublishIdentity,
  seq: number,
): PresenceSnapshot {
  return {
    v: 1,
    cid: identity.charId,
    name: identity.displayName,
    cls: hero.cls,
    tier: hero.tier,
    x: Math.round(hero.x),
    t: seq,
  };
}

/**
 * Should this beat actually go on the wire? `true` when the visible state changed since
 * the last SENT snapshot, or on a keepalive beat (every `keepaliveEvery`-th beat) so a
 * standing-still ghost doesn't get pruned by peers' 10s silence timer. `prev` = the last
 * SENT snapshot (or null if none yet). `beatIndex` = the accumulator tick count.
 */
export function shouldPublish(
  prev: PresenceSnapshot | null,
  next: PresenceSnapshot,
  beatIndex: number,
  keepaliveEvery = 3,
): boolean {
  if (!prev) return true;
  if (prev.x !== next.x || prev.cls !== next.cls || prev.tier !== next.tier) return true;
  return beatIndex % keepaliveEvery === 0;
}
