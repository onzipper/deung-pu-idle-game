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

import { CONFIG, type HeroClass } from "@/engine";

const HERO_CLASSES: readonly HeroClass[] = ["swordsman", "archer", "mage", "ninja"];

/** R4.5 Wave 1.1 (issue #69): the live ground-plane depth-row band, read-only from the
 *  engine's own `CONFIG.plane` (never mutated — this store has zero engine-state coupling,
 *  `ghostGuard.test.ts` pins it). Defense-in-depth clamp for an inbound `py`: a peer on a
 *  stale/mismatched build could send an out-of-band value, so a received row is clamped to
 *  this range rather than trusted verbatim (the render-side clamp the fallback path already
 *  gets for free from `scatterPlaneY`). */
const PLANE_Y_MIN = Math.min(CONFIG.plane.bandFar, CONFIG.plane.bandNear);
const PLANE_Y_MAX = Math.max(CONFIG.plane.bandFar, CONFIG.plane.bandNear);

function clampPlaneY(v: number): number {
  return v < PLANE_Y_MIN ? PLANE_Y_MIN : v > PLANE_Y_MAX ? PLANE_Y_MAX : v;
}

/** Positional smoothing time-constant (ms). A ghost eases toward its latest anchor by
 *  exponential decay — `1 - e^(-elapsed/τ)` of the remaining gap — reaching ~95% in ~3τ.
 *  This is what feeds the rig's x-delta walk animation (heroView derives locomotion from
 *  |dx|/dt). Chosen over a fixed-window LINEAR lerp because, at the 8Hz `pa` beat, a linear
 *  lerp never completed before the next anchor and each re-anchor teleported x forward (a
 *  visible per-beat stair-step — the "robotic" feel). Exponential + capturing the CURRENT
 *  eased position as the next anchor's start (see `applyAction`/`upsert`) gives C0 position
 *  continuity AND distance-proportional velocity (no snap, no rubber-band). τ=90ms keeps
 *  ghosts responsive (~1-beat trail) while reading smoothly at both 8Hz `pa` and 3Hz `p`. */
const LERP_TAU_MS = 90;
/** Fade-in on first appearance / fade-out ramp before prune. */
const FADE_MS = 350;
/** A ghost with no fresh snapshot for this long is pruned (peer left / went silent).
 *  Keyed to the `p` KEEPALIVE clock ONLY — the R3 `pa` action stream never refreshes it
 *  (a chatty action feed must not keep a peer "alive" past their keepalive presence). */
const SILENCE_PRUNE_MS = 10_000;
/** Hard cap on simultaneously-rendered ghosts (design §7; fps valve steps it down). */
export const GHOST_CAP_DEFAULT = 12;

/** R3 action stream (`pa`): the known visual-action values a peer may broadcast. A frame
 *  with any OTHER `a` is dropped by `parseGhostAction` (forward-compat, like the `v` gate). */
export const GHOST_ACTIONS = [
  "idle",
  "walk",
  "basic",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "dash",
] as const;
export type GhostActionKind = (typeof GHOST_ACTIONS)[number];

/** A peer whose action counter jumps BACKWARD by at least this much (vs the stored one)
 *  is treated as a REJOINED session that reset its counter, not a replayed old packet —
 *  see `acceptActionCounter`. */
const ACTION_RESET_BACKWARD = 1_000;

/** A validated inbound snapshot (the wire payload the publisher sends — design §3.3). */
export interface GhostSnapshot {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  x: number;
  /** Monotonic per-sender sequence counter — older-or-equal `t` is ignored (dedup/stale). */
  t: number;
  /** R4.5 Wave 1.1 (issue #69): the peer's live ground-plane depth row, or `null` when the
   *  wire payload omitted/mangled `py` (older sender build, or defense-in-depth reject) —
   *  NEVER `0`, so the render layer can tell "no live row" apart from "row zero" and fall
   *  back to `scatterPlaneY(cid)` exactly as it did before this field existed. */
  planeY: number | null;
}

/** A validated inbound ACTION frame (R3 `pa` — the visual action stream, design §5 wave 3).
 *  Distinct from `GhostSnapshot`: an action is display-pose + facing, NOT liveness — it
 *  never creates a ghost nor refreshes the prune clock (a peer must already be present via
 *  the `p` keepalive). `at` is the per-sender ACTION counter (stale/replay guard); `t` is
 *  the sender wall-clock (parsed for completeness, unused by the store this wave). */
export interface GhostAction {
  cid: string;
  x: number;
  /** Optional world-y (2.5D depth). Parsed for completeness; the store does not act on it
   *  this wave — ghost render depth stays hash(cid)-keyed until the renderer consumes y. */
  y: number | null;
  facing: 1 | -1;
  a: GhostActionKind;
  /** Per-sender monotonic action counter — older-or-equal is rejected (see `applyAction`). */
  at: number;
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
  /** R3 action stream — present ONLY once the ghost has received a `pa` frame; a plain
   *  `p`-only peer omits all three (undefined), so the render layer draws it exactly as
   *  before (walk/idle, velocity-derived facing). */
  facing?: 1 | -1;
  action?: GhostActionKind;
  /** The latest accepted action counter — the render layer edge-triggers a pose when this
   *  advances (see `ghostLayer.ts`). */
  at?: number;
  /** R4.5 Wave 1.1 (issue #69): interpolated live ground-plane depth row this frame —
   *  present ONLY once the peer has sent a `p` snapshot carrying `py`. `undefined` means
   *  "no live row known" (older sender build, or the sender's engine hero has none yet);
   *  the render layer falls back to `scatterPlaneY(cid)` exactly as it did before this
   *  field existed. */
  planeY?: number;
}

interface GhostRecord {
  cid: string;
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  /** Last-known x and the one before it (for the lerp). */
  prevX: number;
  lastX: number;
  /** Lerp ANCHOR clock — advanced by BOTH a `p` snapshot and a (fresher) `pa` action, so
   *  positional interpolation always eases from the most recent position sample. SEPARATE
   *  from `lastAt` (the keepalive/prune clock) so an action can move a ghost without
   *  extending its lifetime. */
  lerpAt: number;
  /** Keepalive/prune clock — advanced ONLY by a `p` snapshot (never by `pa`). */
  lastAt: number;
  firstAt: number;
  lastSeq: number;
  /** R3 action stream (defaults keep a `p`-only ghost byte-identical to today). */
  facing: 1 | -1;
  action: GhostActionKind;
  /** Last accepted action counter, and the real clock when it was accepted (for the
   *  rejoin-reset window in `acceptActionCounter`). `hasAction` gates whether the action
   *  fields are exposed at all — false for a peer seen only via `p`. */
  actionAt: number;
  lastActionAtMs: number;
  hasAction: boolean;
  /** R4.5 Wave 1.1 (issue #69): last-known live depth row and the one before it (for the
   *  lerp), or `null` when no `p` snapshot has ever carried a `py`. DELIBERATELY anchored
   *  by its OWN clock (`planeYAt`), NOT the shared `lerpAt` — `lerpAt` is re-stamped by
   *  every `pa` action beat (8Hz) to re-anchor x, but `pa` carries no `py` this wave; reusing
   *  `lerpAt` here would reset the ease's elapsed time on every action beat and the row would
   *  never visibly converge. Advanced ONLY by `upsert` (the `p` handler). */
  prevPlaneY: number | null;
  lastPlaneY: number | null;
  planeYAt: number;
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
  // R4.5 Wave 1.1: `py` is additive/optional — a missing field, a wrong type (e.g. a
  // string), or a non-finite value (NaN/Infinity) all resolve to `null` ("no live row"),
  // never `0`. An in-range-but-noisy number is clamped, not rejected (defense-in-depth).
  const planeY =
    typeof r.py === "number" && Number.isFinite(r.py) ? clampPlaneY(r.py) : null;
  return { cid, name, cls, tier, x, t, planeY };
}

/** Validate a raw `pa` action payload into a `GhostAction`, or `null` if junk. Strict on
 *  the fields that drive a pose (`v`/`cid`/`x`/known `a`), lenient on cosmetics (a bad `f`
 *  falls back to facing +1, a missing/bad `y` to null, a bad `at` to 0). NEVER throws. */
export function parseGhostAction(raw: unknown): GhostAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null; // deploy-skew safety — unknown protocol version dropped
  const cid = r.cid;
  if (typeof cid !== "string" || !cid) return null;
  const x = r.x;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const a = r.a;
  if (typeof a !== "string" || !(GHOST_ACTIONS as readonly string[]).includes(a)) return null;
  const y = typeof r.y === "number" && Number.isFinite(r.y) ? r.y : null;
  const facing: 1 | -1 = r.f === -1 ? -1 : 1;
  const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0;
  return { cid, x, y, facing, a: a as GhostActionKind, at };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Exponential ease of `prev` toward `target` after `elapsedMs` since the anchor. Pure +
 *  headless-testable. Monotonic (never overshoots `target`), C0-continuous, and — because
 *  the rate is proportional to the remaining gap — velocity-continuous across re-anchors as
 *  long as the caller seeds the next `prev` with the CURRENT sample (which the store does).
 *  At elapsed 0 → `prev`; as elapsed → ∞ → `target`. */
export function easeToward(prev: number, target: number, elapsedMs: number): number {
  const f = 1 - Math.exp(-Math.max(0, elapsedMs) / LERP_TAU_MS);
  return prev + (target - prev) * f;
}

export class GhostStore {
  private readonly ghosts = new Map<string, GhostRecord>();
  /** Identity keys (cid OR displayName) to drop: my own cid + my cohort peers, who are
   *  already fully simulated as real heroes — see `setExcluded`'s doc + design §3.4. */
  private excluded: ReadonlySet<string> = new Set();
  private cap = GHOST_CAP_DEFAULT;

  /** This ghost's eased world-x at `nowMs` — a pure read of its current anchor (no mutation),
   *  shared by `list()` (per-frame draw) and the re-anchor sites (which seed the NEXT anchor's
   *  `prevX` with it, so a fresh anchor never teleports the visible position). */
  private sampleX(g: GhostRecord, nowMs: number): number {
    return easeToward(g.prevX, g.lastX, nowMs - g.lerpAt);
  }

  /** R4.5 Wave 1.1: this ghost's eased live depth row at `nowMs`, or `null` if no `p`
   *  snapshot has ever carried a `py` — same continuity discipline as `sampleX` (the ease
   *  target is a "current visible value → new target" chain, never a raw snap). */
  private samplePlaneY(g: GhostRecord, nowMs: number): number | null {
    if (g.lastPlaneY === null) return null;
    return easeToward(g.prevPlaneY ?? g.lastPlaneY, g.lastPlaneY, nowMs - g.planeYAt);
  }

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
        lerpAt: nowMs,
        lastAt: nowMs,
        firstAt: nowMs,
        lastSeq: snap.t,
        facing: 1,
        action: "idle",
        actionAt: 0,
        lastActionAtMs: 0,
        hasAction: false,
        prevPlaneY: snap.planeY,
        lastPlaneY: snap.planeY,
        planeYAt: nowMs,
      });
      return;
    }
    if (snap.t <= existing.lastSeq && snap.t !== 0) return; // stale/duplicate (t:0 = keepalive-less sender)
    existing.prevX = this.sampleX(existing, nowMs); // start from where we VISIBLY are (no snap)
    existing.lastX = snap.x;
    existing.lerpAt = nowMs; // keepalive also re-anchors the ease
    existing.lastAt = nowMs;
    existing.lastSeq = snap.t;
    existing.name = snap.name;
    existing.cls = snap.cls;
    existing.tier = snap.tier;
    // R4.5 Wave 1.1: re-anchor the depth-row ease from wherever it's VISIBLY eased to right
    // now (mirrors the x treatment above) — never jump straight to the raw snap. A snapshot
    // with no `py` (older sender, or a defensive gap) drops the row back to "unknown" so the
    // render layer falls back to `scatterPlaneY(cid)` rather than freezing a stale row. A
    // row appearing for the FIRST time (no prior known row to ease from) starts exactly at
    // the snap, same as a brand-new ghost above.
    existing.prevPlaneY =
      snap.planeY === null
        ? null
        : existing.lastPlaneY === null
          ? snap.planeY
          : this.samplePlaneY(existing, nowMs);
    existing.lastPlaneY = snap.planeY;
    existing.planeYAt = nowMs;
  }

  /** Parse + apply one raw `pa` action frame (mirrors `upsert`'s one-call surface for the
   *  GameClient wiring wave). Junk is ignored. */
  ingestAction(raw: unknown, nowMs: number): void {
    const action = parseGhostAction(raw);
    if (action) this.applyAction(action, nowMs);
  }

  /**
   * Apply a validated `pa` action to an EXISTING ghost. THE ONE RULE still holds: this only
   * updates render-facing pose/facing state; it never touches the engine.
   *
   * - `pa` is NOT liveness: an action for an unknown cid is dropped (a peer must be present
   *   via a `p` keepalive first), and this never advances the prune clock (`lastAt`).
   * - Position IS refreshed (`pa` is ~8Hz vs `p` ~3Hz — fresher), re-anchoring the lerp
   *   (`lerpAt`) only, so a ghost can move on its action stream without extending its life.
   * - Stale/replayed/out-of-order counters are rejected; a rejoined peer that RESET its
   *   counter is accepted (see `acceptActionCounter`).
   */
  applyAction(action: GhostAction, nowMs: number): void {
    if (this.excluded.has(action.cid)) return;
    const g = this.ghosts.get(action.cid);
    if (!g) return; // action without keepalive presence — not liveness, so never spawns
    if (!this.acceptActionCounter(g, action.at, nowMs)) return;
    g.prevX = this.sampleX(g, nowMs); // continuity: ease from the current visible x, not the old target
    g.lastX = action.x; // fresher than the keepalive x — advance the ease target
    g.lerpAt = nowMs; // ...but NOT `lastAt`: an action must not keep a silent peer alive
    g.facing = action.facing;
    g.action = action.a;
    g.actionAt = action.at;
    g.lastActionAtMs = nowMs;
    g.hasAction = true;
  }

  /**
   * Accept this action counter? Rules:
   *  - first-ever action for the ghost → accept (seeds `actionAt`).
   *  - `at` strictly greater than the stored counter → accept (normal forward advance).
   *  - otherwise it's stale/duplicate/replayed WITHIN an active session → reject, UNLESS
   *    it looks like a REJOINED session that reset its counter, detected by EITHER:
   *      (a) the ghost has had no accepted action for ≥ SILENCE_PRUNE_MS (it went quiet
   *          long enough that a fresh session is the likely explanation), OR
   *      (b) the counter jumped backward by ≥ ACTION_RESET_BACKWARD (a clearly-fresh low
   *          counter, e.g. restarting near 0 far below the stored value).
   */
  private acceptActionCounter(g: GhostRecord, at: number, nowMs: number): boolean {
    if (!g.hasAction) return true;
    if (at > g.actionAt) return true;
    if (nowMs - g.lastActionAtMs >= SILENCE_PRUNE_MS) return true; // rejoin: quiet long enough
    if (at < g.actionAt - ACTION_RESET_BACKWARD) return true; // rejoin: counter clearly reset
    return false;
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
      const silence = nowMs - g.lastAt; // prune/fade keyed to the keepalive clock ONLY
      if (silence > SILENCE_PRUNE_MS) continue;
      const x = this.sampleX(g, nowMs); // ...position eases to its own anchor (see easeToward)
      const planeY = this.samplePlaneY(g, nowMs); // R4.5 Wave 1.1: null -> caller falls back
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
        // Action fields only for a peer that has actually sent a `pa` — a `p`-only ghost
        // omits them so the render layer draws it exactly as before.
        ...(g.hasAction ? { facing: g.facing, action: g.action, at: g.actionAt } : null),
        // R4.5 Wave 1.1: live depth row only when known — a `p`-only-legacy or not-yet-
        // stamped peer omits it, so the render layer falls back to `scatterPlaneY(cid)`.
        ...(planeY !== null ? { planeY } : null),
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
      ...(it.action !== undefined
        ? { facing: it.facing, action: it.action, at: it.at }
        : null),
      ...(it.planeY !== undefined ? { planeY: it.planeY } : null),
    }));
  }
}
