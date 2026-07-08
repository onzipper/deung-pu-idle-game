/**
 * Owner UX round (2026-07-09) — "ปุ่มตีบวก works from anywhere". Pure state-
 * machine helper for the multi-step "smith trip" a press of `RefineButton.tsx`
 * kicks off: fast-travel to town (if needed) -> walk to ลุงดึ๋ง's anchor ->
 * auto-open his refine dialog through the SAME seam tap-to-talk uses. Kept
 * pure/headless (no React/Zustand here) so the transition logic is unit-
 * testable without the store — `gameStore.ts`'s `advanceSmithTrip` action is
 * the only caller, invoked off the throttled snapshot (`SmithTripWatcher.tsx`).
 */

export type SmithTripPhase = "idle" | "traveling" | "walking";

export interface SmithTripContext {
  /** Current location is the town zone. */
  inTown: boolean;
  /** Within ลุงดึ๋ง's talk range — only meaningful while `inTown`. */
  inRange: boolean;
  /** The solo hero is dead — cancels the trip silently (owner rule). */
  dead: boolean;
}

export type SmithTripEffect = "openPanel" | "walkToSmith" | null;

export interface SmithTripStep {
  phase: SmithTripPhase;
  effect: SmithTripEffect;
}

/**
 * Advances an ACTIVE trip (`phase !== "idle"`) by one throttled-snapshot tick.
 * `"idle"` is always a no-op passthrough — there's nothing to advance (a fresh
 * trip is instead started by `gameStore.ts`'s `startSmithTrip`, which decides
 * the FIRST phase off the same context read once, synchronously, on the
 * button press).
 *
 * Death always cancels silently, regardless of location (owner rule — no
 * dangling walk order after a respawn). Once in town: in range opens the
 * panel (trip ends); out of range walks to the smith — but only emits the
 * `walkToSmith` effect on the actual transition INTO `"walking"`, so a
 * still-walking tick (the common case between ~100ms syncs) is a clean no-op
 * rather than re-queuing the same `moveTo` intent every tick. Still outside
 * town: stays `"traveling"` — the fast-travel channel itself is engine-owned,
 * this just waits for `inTown` to flip true on arrival.
 */
export function nextSmithTripStep(
  phase: SmithTripPhase,
  ctx: SmithTripContext,
): SmithTripStep {
  if (phase === "idle") return { phase: "idle", effect: null };
  if (ctx.dead) return { phase: "idle", effect: null };
  if (ctx.inTown) {
    if (ctx.inRange) return { phase: "idle", effect: "openPanel" };
    if (phase === "walking") return { phase: "walking", effect: null };
    return { phase: "walking", effect: "walkToSmith" };
  }
  return { phase: "traveling", effect: null };
}
