/**
 * Owner UX round (2026-07-09) "ปุ่มตีบวก works from anywhere" — generalized
 * R2.5-W3: pure state-machine helper for a "trip to any town NPC", not just
 * ลุงดึ๋ง. Originally `smithTrip.ts` (M7.6, ลุงดึ๋ง-only); this is the same
 * machine with the NPC-specific bits (which anchor, which panel) lifted out to
 * the caller — `gameStore.ts`'s `startNpcTrip(npcId)` reads `TownNpcId`-keyed
 * config (`townNpcConfig`) and remembers WHICH npc a trip targets in
 * `npcTripTarget`; this module only knows "traveling to town" / "walking to
 * an in-town anchor" / "arrived, open the dialog".
 *
 * Fast-travels to town (if needed) -> walks to the target NPC's anchor ->
 * auto-opens that NPC's dialog through the SAME seam tap-to-talk uses
 * (`TownNpcPanelHost.tsx`). Kept pure/headless (no React/Zustand/engine-id
 * awareness here) so the transition logic is unit-testable without the store
 * — `gameStore.ts`'s `advanceNpcTrip` action is the only caller, invoked off
 * the throttled snapshot (`NpcTripWatcher.tsx`).
 */

export type NpcTripPhase = "idle" | "traveling" | "walking";

export interface NpcTripContext {
  /** Current location is the town zone. */
  inTown: boolean;
  /** Within the TARGET npc's talk range — only meaningful while `inTown`. */
  inRange: boolean;
  /** The solo hero is dead — cancels the trip silently (owner rule). */
  dead: boolean;
}

export type NpcTripEffect = "openPanel" | "walkToNpc" | null;

export interface NpcTripStep {
  phase: NpcTripPhase;
  effect: NpcTripEffect;
}

/**
 * Advances an ACTIVE trip (`phase !== "idle"`) by one throttled-snapshot tick.
 * `"idle"` is always a no-op passthrough — there's nothing to advance (a fresh
 * trip is instead started by `gameStore.ts`'s `startNpcTrip`, which decides
 * the FIRST phase off the same context read once, synchronously, on the
 * trigger press).
 *
 * Death always cancels silently, regardless of location (owner rule — no
 * dangling walk order after a respawn). Once in town: in range opens the
 * panel (trip ends); out of range walks to the target NPC — but only emits
 * the `walkToNpc` effect on the actual transition INTO `"walking"`, so a
 * still-walking tick (the common case between ~100ms syncs) is a clean no-op
 * rather than re-queuing the same `moveTo` intent every tick. Still outside
 * town: stays `"traveling"` — the fast-travel channel itself is engine-owned,
 * this just waits for `inTown` to flip true on arrival.
 */
export function nextNpcTripStep(phase: NpcTripPhase, ctx: NpcTripContext): NpcTripStep {
  if (phase === "idle") return { phase: "idle", effect: null };
  if (ctx.dead) return { phase: "idle", effect: null };
  if (ctx.inTown) {
    if (ctx.inRange) return { phase: "idle", effect: "openPanel" };
    if (phase === "walking") return { phase: "walking", effect: null };
    return { phase: "walking", effect: "walkToNpc" };
  }
  return { phase: "traveling", effect: null };
}
