/**
 * Ghost-presence RECEIVE store (docs/ghost-presence-design.md §3.4). PURE + testable:
 * it ingests peer presence snapshots off the world socket and produces an interpolated,
 * faded, capped list of "ghosts" for the render layer to draw — and NOTHING else.
 *
 * The One Rule (design §2): presence data is render-only. This store's ENTIRE write
 * surface is `upsert()`; it holds no reference to the engine, the input queue, or any
 * mutator. A ghost can never move, command, or affect a hero. The lockstep guard test
 * (`__tests__/ghostGuard.test.ts`) pins that structurally.
 */

import type { HeroClass } from "@/engine";

const HERO_CLASSES: readonly HeroClass[] = ["swordsman", "archer", "mage", "ninja"];

/** Positional interpolation window: a ghost eases from its previous to its latest
 *  sampled x over this long after each snapshot arrives, which is what feeds the rig's
 *  x-delta walk animation (heroView derives locomotion from |dx|/dt). ~one publish beat. */
const LERP_MS = 350;
/** Fade-in on first appearance / fade-out ramp before prune. */
const FADE_MS = 350;
/** A ghost with no fresh snapshot for this long is pruned (peer left / went silent). */
const SILENCE_PRUNE_MS = 10_000;
/** Hard cap on simultaneously-rendered ghosts (design §7; fps valve steps it down). */
export const GHOST_CAP_DEFAULT = 12;

/** A validated inbound snapshot (the wire payload the publisher sends — design §3.3). */
export interface GhostSnapshot {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  x: number;
  /** Monotonic per-sender sequence counter — older-or-equal `t` is ignored (dedup/stale). */
  t: number;
}

/** What the render layer needs to draw one ghost this frame. */
export interface GhostRenderItem {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  /** Interpolated world-x this frame. */
  x: number;
  /** 0..1 fade (in on appear, out before prune). */
  alpha: number;
}

interface GhostRecord {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  /** Last-known x and the one before it (for the lerp), with their arrival times. */
  prevX: number;
  lastX: number;
  lastAt: number;
  firstAt: number;
  lastSeq: number;
}

/** Validate + normalize a raw wire payload into a `GhostSnapshot`, or `null` if junk.
 *  Deliberately permissive on cosmetics (unknown class → swordsman) but strict on the
 *  identity/position fields a receiver actually needs. NEVER throws on garbage. */
export function parseGhostSnapshot(raw: unknown): GhostSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null; // deploy-skew safety — unknown protocol version dropped
  const cid = r.cid;
  if (typeof cid !== "string" || !cid) return null;
  const x = r.x;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const cls =
    typeof r.cls === "string" && (HERO_CLASSES as readonly string[]).includes(r.cls)
      ? (r.cls as HeroClass)
      : "swordsman";
  const tierNum = typeof r.tier === "number" ? r.tier : 1;
  const tier: 1 | 2 | 3 = tierNum === 3 ? 3 : tierNum === 2 ? 2 : 1;
  const name = typeof r.name === "string" ? r.name : "";
  const t = typeof r.t === "number" && Number.isFinite(r.t) ? r.t : 0;
  return { cid, name, cls, tier, x, t };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class GhostStore {
  private readonly ghosts = new Map<string, GhostRecord>();
  /** Identity keys (cid OR displayName) to drop: my own cid + my cohort peers, who are
   *  already fully simulated as real heroes — see `setExcluded`'s doc + design §3.4. */
  private excluded: ReadonlySet<string> = new Set();
  private cap = GHOST_CAP_DEFAULT;

  /**
   * Ingest one peer snapshot. Junk is ignored; a stale/duplicate `t` for a known ghost
   * is ignored; an excluded identity is dropped. `nowMs` = the receive time (real clock).
   */
  upsert(raw: unknown, nowMs: number): void {
    const snap = parseGhostSnapshot(raw);
    if (!snap) return;
    if (this.excluded.has(snap.cid) || (snap.name && this.excluded.has(snap.name))) return;
    const existing = this.ghosts.get(snap.cid);
    if (!existing) {
      this.ghosts.set(snap.cid, {
        cid: snap.cid,
        name: snap.name,
        cls: snap.cls,
        tier: snap.tier,
        prevX: snap.x,
        lastX: snap.x,
        lastAt: nowMs,
        firstAt: nowMs,
        lastSeq: snap.t,
      });
      return;
    }
    if (snap.t <= existing.lastSeq && snap.t !== 0) return; // stale/duplicate (t:0 = keepalive-less sender)
    existing.prevX = existing.lastX;
    existing.lastX = snap.x;
    existing.lastAt = nowMs;
    existing.lastSeq = snap.t;
    existing.name = snap.name;
    existing.cls = snap.cls;
    existing.tier = snap.tier;
  }

  /** Drop ghosts silent past the prune window. Call ~every frame with the real clock. */
  prune(nowMs: number): void {
    for (const [cid, g] of this.ghosts) {
      if (nowMs - g.lastAt > SILENCE_PRUNE_MS) this.ghosts.delete(cid);
    }
  }

  /** Set the identity keys (cid and/or displayName) to suppress: always my own cid, plus
   *  my cohort peers' display names (they render as real lockstep heroes, so their ghost
   *  is a duplicate). Applied on ingest AND on `list()`, so a change takes effect at once.
   *  NOTE: the party wire carries no charId for peers, so cohort dedup keys on displayName
   *  (a rare name collision is a harmless cosmetic double-draw). */
  setExcluded(keys: ReadonlySet<string>): void {
    this.excluded = keys;
  }

  /** fps valve: cap the number of ghosts rendered (design §7 — 12 → 6 → 0). */
  setCap(cap: number): void {
    this.cap = Math.max(0, cap);
  }

  clear(): void {
    this.ghosts.clear();
  }

  /** The interpolated, faded, deduped, capped render list for THIS frame. */
  list(nowMs: number): GhostRenderItem[] {
    const items: (GhostRenderItem & { lastAt: number })[] = [];
    for (const g of this.ghosts.values()) {
      if (this.excluded.has(g.cid) || (g.name && this.excluded.has(g.name))) continue;
      const silence = nowMs - g.lastAt;
      if (silence > SILENCE_PRUNE_MS) continue;
      const lerpF = clamp01((nowMs - g.lastAt) / LERP_MS);
      const x = g.prevX + (g.lastX - g.prevX) * lerpF;
      const fadeIn = clamp01((nowMs - g.firstAt) / FADE_MS);
      const fadeOut =
        silence > SILENCE_PRUNE_MS - FADE_MS
          ? clamp01((SILENCE_PRUNE_MS - silence) / FADE_MS)
          : 1;
      items.push({
        cid: g.cid,
        name: g.name,
        cls: g.cls,
        tier: g.tier,
        x,
        alpha: Math.min(fadeIn, fadeOut),
        lastAt: g.lastAt,
      });
    }
    if (items.length > this.cap) {
      // Deterministic: keep the freshest, tie-break by cid.
      items.sort((a, b) => b.lastAt - a.lastAt || (a.cid < b.cid ? -1 : 1));
      items.length = this.cap;
    }
    return items.map((it) => ({
      cid: it.cid,
      name: it.name,
      cls: it.cls,
      tier: it.tier,
      x: it.x,
      alpha: it.alpha,
    }));
  }
}
