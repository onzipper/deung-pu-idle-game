/**
 * Owner UX round (2026-07-09) — "เดินไปที่ประตูก่อน แล้วค่อยวาป" (walk to the
 * gate first, THEN transition). Pure state-machine helper mirroring
 * `npcTrip.ts`'s idiom exactly: a gate tap (`resolveGateTap`'s "walk"
 * action) no longer fires `walkToZone` immediately — it issues the SAME
 * manual `moveTo` intent a ground tap uses (targeting the gate's own anchor
 * x), arms this trip, and a per-tick watcher (`GateTripWatcher.tsx`) fires
 * the ORIGINAL `walkToZone` intent once the hero arrives.
 *
 * Kept pure/headless (no React/Zustand here) so the transition logic is
 * unit-testable without the store — `gameStore.ts`'s `startGateTrip` /
 * `advanceGateTrip` / `cancelGateTrip` actions are the only callers, the
 * first two invoked off `GameClient.tsx`'s `onGateTap` and the throttled
 * snapshot (`GateTripWatcher.tsx`) respectively.
 *
 * Unlike `npcTrip` (which has a `"traveling"` phase for the fast-travel
 * leg into town), a gate is always in the CURRENT zone — there is only one
 * active phase, `"walking"`. Four independent cancel conditions are baked
 * into the pure decision below (death, timeout, and an external zone
 * change); the FIFTH — "the player issued a different manual command" — is
 * handled by `gameStore.ts` resetting the field directly (mirrors
 * `npcTrip`'s own `queueMoveTo`/`queueAttackTarget` bypass), since that's
 * an edge on OTHER store actions, not a property of this tick's context.
 */

import type { WorldLocation } from "@/engine";

export type GateTripPhase = "idle" | "walking";

/** Everything the trip needs to remember from the moment it was armed. */
export interface GateTripTarget {
  /** The gate's own anchor x (`gateAnchorX` in `./gateTap.ts`) — the moveTo
   * destination AND the arrival check's reference point. */
  gateX: number;
  /** The zone to transition into on arrival — the exact `walkToZone` intent
   * argument `resolveGateTap`'s "walk" action already carries. */
  destination: WorldLocation;
  /** The zone the trip was armed FROM (the player tapped the gate while
   * standing here). A live location that drifts away from this BEFORE
   * arrival means some OTHER mechanism moved the hero (a different
   * fast-travel, bot auto-advance, a cohort re-seed, …) — never our own
   * transition, which only ever fires from here. */
  originZone: WorldLocation;
  /** Wall-clock `Date.now()` at arm time — the `GATE_TRIP_TIMEOUT_MS` safety
   * net below. */
  armedAt: number;
}

export interface GateTripContext {
  /** My hero's current x position (throttled-snapshot precision — plenty
   * given the generous `GATE_TRIP_ARRIVE_RADIUS`). */
  heroX: number;
  /** The solo hero is dead — cancels the trip silently (owner rule, mirrors
   * `npcTrip`'s death cancel). */
  dead: boolean;
  /** The CURRENT world location — compared against `target.originZone`. */
  currentZone: WorldLocation;
  /** Wall-clock `Date.now()` "now". */
  nowMs: number;
}

export type GateTripEffect = "transition" | null;

export interface GateTripStep {
  phase: GateTripPhase;
  effect: GateTripEffect;
}

/** Arrival radius (world units) — generous enough that a throttled ~10Hz
 * hero-x read never overshoots past it between ticks at ordinary walk
 * speeds. */
export const GATE_TRIP_ARRIVE_RADIUS = 40;

/** Safety-net timeout — a trip stuck walking (a snagged path, a monster
 * blocking, an idle-bot fight) gives up rather than dangling forever. */
export const GATE_TRIP_TIMEOUT_MS = 20_000;

/**
 * Advances an ACTIVE trip (`phase !== "idle"`) by one throttled-snapshot
 * tick. `"idle"` is always a no-op passthrough — a fresh trip is instead
 * started by `gameStore.ts`'s `startGateTrip`, which arms the FIRST
 * `"walking"` phase synchronously, on the tap itself.
 *
 * Order matters: death is checked first (mirrors `npcTrip`), then an
 * external zone change (the trip's own transition never reaches this
 * check — it fires from `originZone`, never after), then the timeout, then
 * arrival. Firing `"transition"` is the ONLY way out of this function that
 * still asks the caller to act — every other exit is a silent cancel back
 * to `"idle"`. The caller (`advanceGateTrip`) always clears the phase back
 * to `"idle"` the instant this returns anything other than `{ phase:
 * "walking", effect: null }`, so a repeat call with the SAME "arrived"
 * inputs never fires twice (the top `"idle"` guard short-circuits it).
 */
export function nextGateTripStep(
  phase: GateTripPhase,
  target: GateTripTarget,
  ctx: GateTripContext,
): GateTripStep {
  if (phase === "idle") return { phase: "idle", effect: null };
  if (ctx.dead) return { phase: "idle", effect: null };
  if (
    ctx.currentZone.mapId !== target.originZone.mapId ||
    ctx.currentZone.zoneIdx !== target.originZone.zoneIdx
  ) {
    return { phase: "idle", effect: null };
  }
  if (ctx.nowMs - target.armedAt >= GATE_TRIP_TIMEOUT_MS) {
    return { phase: "idle", effect: null };
  }
  if (Math.abs(ctx.heroX - target.gateX) <= GATE_TRIP_ARRIVE_RADIUS) {
    return { phase: "idle", effect: "transition" };
  }
  return { phase: "walking", effect: null };
}
