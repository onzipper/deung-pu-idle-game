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
import type { GhostActionKind } from "./ghostStore";

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

/**
 * R3 wave-3 "visual action stream" — PUBLISH side of the `pa` opcode
 * (docs/ghost-presence-design.md §5 wave 3; wire shape `{v,cid,x,y?,f,a,at,t}`). Same
 * one-way discipline as `buildPresenceSnapshot`/`shouldPublish` above: pure sampling of MY
 * OWN hero, never a command, never round-tripped. `GameClient` runs a SEPARATE ~125ms (8Hz)
 * accumulator for this stream (chattier than the ~330ms `p` beat above, because it carries
 * one-shot poses that read wrong if delayed) and degrades its rate in lockstep with the
 * ghost render cap via `actionBeatMsForEma` below.
 */

/** ~8Hz ceiling for the action stream (design §5 wave 3) — well under the relay's
 *  per-connection rate limit even alongside the `p` beat. */
export const PRESENCE_ACTION_BEAT_MS = 125;

/** fps-EMA valve thresholds (ms), shared between the ghost render cap (12→6→0, see
 *  `GameClient`'s presence block `wantCap`) and `actionBeatMsForEma` below — the SAME two
 *  constants feed both so the render-cap valve and the action-rate valve step down at
 *  EXACTLY the same EMA samples and can never drift apart. */
export const GHOST_VALVE_HEAVY_MS = 33;
export const GHOST_VALVE_LIGHT_MS = 22;

/** Minimal read-only "my hero" view the action sampler needs. `aimX` mirrors the engine's
 *  `Hero.aimX` (this step's combat aim, null when not engaging anything) — the same field
 *  the render rig uses to face a kiting hero at its target instead of its retreat
 *  direction. `y` is OPTIONAL: the engine's `hero.y` has no per-hero variance yet (a fixed
 *  per-map constant), so callers may simply omit it; wired here so a future y-varying hero
 *  needs no protocol change (design §3.3). */
export interface ActionHero {
  x: number;
  aimX: number | null;
  y?: number;
}

/**
 * What actually happened THIS beat, as GameClient already knows it (edge-detected from
 * `hero.cd` resetting for a basic attack, or a `skillCast`/`heroDashed` event for THIS hero
 * this frame — see `docs/known-traps.md`'s rAF-drop bug class: the caller must LATCH this
 * across every rAF frame in the beat window, not just the frame the beat elapses on, or a
 * mid-window cast/dash silently vanishes). `{kind:"none"}` = a continuous walk/idle beat
 * with no one-shot action.
 */
export type ActionEdge =
  | { kind: "none" }
  | { kind: "basic" }
  | { kind: "skill"; slot: 1 | 2 | 3 | 4 }
  | { kind: "dash" };

/** The wire payload for one `pa` frame (design §5 wave 3). */
export interface ActionSample {
  v: 1;
  cid: string;
  x: number;
  y?: number;
  /** Facing: `1` = +x (right), `-1` = -x (left). */
  f: 1 | -1;
  a: GhostActionKind;
  /** Per-sender ACTION counter — bumps ONLY on a real edge (basic/skill/dash), never on a
   *  walk/idle-only beat, so the receiver can edge-trigger a one-shot pose exactly once per
   *  real occurrence (see `GhostStore.applyAction`'s doc). */
  at: number;
  /** Sender wall-clock ms this sample was built (completeness field; not a sequence — `at`
   *  is the stale/replay guard). */
  t: number;
}

/** |Δx| below this (over a beat) doesn't count as movement — holds "idle" through combat
 *  jitter (a hero nudging half a pixel while trading hits shouldn't read as walking) and
 *  holds facing through the same noise. Same units as `hero.x` (already publish-rounded
 *  elsewhere, so effectively sub-pixel). */
const MOTION_DEADBAND_PX = 0.5;

/**
 * Derive this beat's facing. The engine's live combat aim wins (mirrors the render rig's
 * own precedence: a kiting ranged hero faces its target, not its retreat direction);
 * otherwise fall back to the x-velocity sign since the last sample; otherwise HOLD the
 * previous facing (a standing-still hero must not flip on floating-point/deadband noise).
 * Pure — reads `hero`/`prevX`/`prevFacing`, returns a value, mutates nothing.
 */
export function deriveActionFacing(
  hero: ActionHero,
  prevX: number | null,
  prevFacing: 1 | -1,
): 1 | -1 {
  if (hero.aimX !== null && Math.abs(hero.aimX - hero.x) > MOTION_DEADBAND_PX) {
    return hero.aimX >= hero.x ? 1 : -1;
  }
  if (prevX !== null && Math.abs(hero.x - prevX) > MOTION_DEADBAND_PX) {
    return hero.x >= prevX ? 1 : -1;
  }
  return prevFacing;
}

/**
 * Build this beat's action sample. PURE: reads `hero`/`identity`/`edge`, returns a fresh
 * object, mutates nothing (mirrors `buildPresenceSnapshot`'s contract). `facing` is
 * pre-derived by the caller (`deriveActionFacing`) so this stays a plain assembler. `edge`
 * names a discrete one-shot action this beat, or `{kind:"none"}` for a continuous beat —
 * walk vs idle is then inferred from `prevX`.
 */
export function buildActionSample(
  hero: ActionHero,
  identity: PublishIdentity,
  edge: ActionEdge,
  facing: 1 | -1,
  prevX: number | null,
  at: number,
  t: number,
): ActionSample {
  const x = Math.round(hero.x);
  const moving = prevX !== null && Math.abs(x - prevX) >= MOTION_DEADBAND_PX;
  const a: GhostActionKind =
    edge.kind === "basic"
      ? "basic"
      : edge.kind === "skill"
        ? (`skill${edge.slot}` as GhostActionKind)
        : edge.kind === "dash"
          ? "dash"
          : moving
            ? "walk"
            : "idle";
  return {
    v: 1,
    cid: identity.charId,
    x,
    ...(hero.y !== undefined ? { y: Math.round(hero.y) } : null),
    f: facing,
    a,
    at,
    t,
  };
}

/**
 * Should this beat actually go on the wire? `true` on: a real position change (Δx ≥ 1px),
 * a facing flip, the action counter advancing (a real basic/skill/dash edge this beat), or
 * a y change (additive — compared only when BOTH samples carry `y`). A plain idle→idle beat
 * with nothing new stays SILENT — liveness is the `p` keepalive's job, not this stream's
 * (`GhostStore.applyAction`'s doc: `pa` never refreshes the peer's prune clock).
 */
export function shouldPublishAction(prev: ActionSample | null, next: ActionSample): boolean {
  if (!prev) return true;
  if (Math.abs(next.x - prev.x) >= 1) return true;
  if (next.f !== prev.f) return true;
  if (next.at !== prev.at) return true;
  if (next.y !== undefined && prev.y !== undefined && next.y !== prev.y) return true;
  return false;
}

/**
 * fps-EMA valve for the action-beat RATE (design §5 wave 3 perf note): steps 8Hz → 4Hz → 0
 * at the SAME thresholds as the ghost render cap (`GameClient`'s `wantCap`), fed by the SAME
 * two constants (`GHOST_VALVE_HEAVY_MS`/`GHOST_VALVE_LIGHT_MS`) so the two valves cannot
 * drift apart. Returns the beat interval in ms, or `0` to suspend the action stream
 * entirely (the `p` presence beat keeps running at its own, coarser, valve step).
 */
export function actionBeatMsForEma(emaMs: number): number {
  if (emaMs > GHOST_VALVE_HEAVY_MS) return 0;
  if (emaMs > GHOST_VALVE_LIGHT_MS) return PRESENCE_ACTION_BEAT_MS * 2;
  return PRESENCE_ACTION_BEAT_MS;
}
