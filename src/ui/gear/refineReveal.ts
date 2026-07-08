/**
 * M7.6+ ตีบวก reveal redesign (owner: "ผลลัพธ์เผยตอนค้อนลงเท่านั้น" — the result must
 * NEVER be visible before the final hammer strike lands). Pure, headlessly-tested
 * state machine driving `RefinePanel.tsx`'s suspense sequence: `idle -> pending ->
 * striking(n) -> reveal(outcome) -> idle`. This module owns ZERO timers/DOM/audio —
 * `RefinePanel.tsx` schedules the `"beat"` dispatches (one per hammer strike) and
 * fires the network call independently; this reducer only decides WHEN the already
 * -known-but-withheld result is allowed to become visible.
 *
 * Design invariant: the server result can land at any time relative to the strike
 * choreography (fast network vs. slow network). Either way it is stashed in `held`
 * and NOT surfaced until the final beat has landed (`beat >= totalBeats`) — that's
 * what "the result leaks before the hammer" (the bug this fixes) becomes structurally
 * impossible: nothing outside `reveal` state ever exposes `held`'s values to a
 * component that renders them as the settled outcome (see `RefinePanel.tsx`'s
 * `revealState.kind === "reveal"` gate before it calls `applyRefineResult`).
 */

/** The frozen server outcome, computed once and carried unmodified through
 * `pending`/`striking` until the state machine allows it to surface at `reveal`.
 * Doubles as `refineFlow.ts#applyRefineResult`'s input (same shape, no reshaping
 * at apply-time — the "held-values snapshot" the reducer tests assert on). */
export interface HeldRefineValues {
  outcomeKind: "success" | "degrade" | "safe" | "break";
  refineLevel: number;
  destroyed: boolean;
  fortified: boolean;
  materialsDelta: number;
  goldDelta: number;
}

export type RefineRevealState =
  | { kind: "idle" }
  | { kind: "pending"; totalBeats: number; held: HeldRefineValues | null; skipRequested: boolean }
  | {
      kind: "striking";
      beat: number;
      totalBeats: number;
      held: HeldRefineValues | null;
      skipRequested: boolean;
    }
  | { kind: "reveal"; held: HeldRefineValues };

export type RefineRevealAction =
  | { type: "start"; totalBeats: number }
  | { type: "beat" }
  | { type: "resultReady"; held: HeldRefineValues }
  | { type: "skip" }
  | { type: "settle" };

export const IDLE_REVEAL_STATE: RefineRevealState = { kind: "idle" };

/**
 * `type: "beat"` advances exactly one hammer strike. The FINAL beat only reveals
 * immediately if the server result is already `held` (fast network) — otherwise it
 * parks at `striking(beat: totalBeats)` (hammer fully charged, waiting) until
 * `resultReady` arrives and reveals it on the spot. Either ordering produces the
 * exact same "reveal happens no earlier than the final strike" guarantee.
 */
export function refineRevealReducer(
  state: RefineRevealState,
  action: RefineRevealAction,
): RefineRevealState {
  switch (action.type) {
    case "start":
      return { kind: "pending", totalBeats: action.totalBeats, held: null, skipRequested: false };

    case "beat": {
      if (state.kind === "pending") {
        const beat = 1;
        if (beat >= state.totalBeats && state.held) return { kind: "reveal", held: state.held };
        return {
          kind: "striking",
          beat,
          totalBeats: state.totalBeats,
          held: state.held,
          skipRequested: state.skipRequested,
        };
      }
      if (state.kind === "striking") {
        const beat = Math.min(state.beat + 1, state.totalBeats);
        if (beat >= state.totalBeats && state.held) return { kind: "reveal", held: state.held };
        return { ...state, beat };
      }
      return state;
    }

    case "resultReady": {
      if (state.kind === "pending") {
        if (state.skipRequested) return { kind: "reveal", held: action.held };
        return { ...state, held: action.held };
      }
      if (state.kind === "striking") {
        if (state.skipRequested || state.beat >= state.totalBeats) {
          return { kind: "reveal", held: action.held };
        }
        return { ...state, held: action.held };
      }
      return state;
    }

    // Tap-to-skip (owner: stays from the original design). During pending/striking
    // it jumps straight to reveal IF the outcome is already known, otherwise it just
    // marks intent so the NEXT `resultReady` reveals immediately instead of waiting
    // out the remaining beats. During reveal it retires the outcome banner early
    // (same "hammer-spam ready immediately" behaviour as before this redesign).
    case "skip": {
      if (state.kind === "pending" || state.kind === "striking") {
        if (state.held) return { kind: "reveal", held: state.held };
        return { ...state, skipRequested: true };
      }
      if (state.kind === "reveal") return { kind: "idle" };
      return state;
    }

    case "settle":
      return { kind: "idle" };

    default:
      return state;
  }
}

/** Which fail-mode band drives the strike choreography (`RefinePanel.tsx`'s own
 * `band` display value, PLUS a distinct `"fortified"` band for guaranteed-success
 * "ใช้แกร่ง" attempts — same cost, shorter suspense since the outcome is certain,
 * but the moment still gets weight per owner spec). */
export type RefineBeatBand = "safe" | "degrade" | "break" | "fortified";

export interface RefineBeatPlan {
  totalBeats: number;
  /** ms delay of each beat, measured from the strike sequence's start (NOT
   * cumulative) — `RefinePanel.tsx` sums a running total to schedule timers. */
  beatDelaysMs: readonly number[];
  /** The `"break"` band (+8..+10, item can be destroyed) gets a 4th beat AND a
   * subtle shake on it — longer, tenser suspense for the riskiest attempts. */
  shake: boolean;
}

/** 3 beats, slow -> fast (~920ms total suspense). */
const NORMAL_BEAT_DELAYS: readonly number[] = [420, 300, 200];
/** 4 beats, slow -> fast (~1150ms total) — the +8..+10 break band. */
const RISKY_BEAT_DELAYS: readonly number[] = [420, 320, 240, 170];
/** 2 beats (~460ms) — guaranteed-success fortify keeps SOME suspense, just less. */
const FORTIFIED_BEAT_DELAYS: readonly number[] = [280, 180];

export function beatPlanFor(band: RefineBeatBand): RefineBeatPlan {
  if (band === "fortified") {
    return { totalBeats: FORTIFIED_BEAT_DELAYS.length, beatDelaysMs: FORTIFIED_BEAT_DELAYS, shake: false };
  }
  if (band === "break") {
    return { totalBeats: RISKY_BEAT_DELAYS.length, beatDelaysMs: RISKY_BEAT_DELAYS, shake: true };
  }
  return { totalBeats: NORMAL_BEAT_DELAYS.length, beatDelaysMs: NORMAL_BEAT_DELAYS, shake: false };
}
