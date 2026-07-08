/**
 * M8 party Wave 3 "signal chip" (docs/ghost-presence-design.md) — pure `cohortStatus`
 * + RTT -> visual (tone/bar-count/pulsing) mapping, kept out of `PartySignalChip.tsx`
 * so it's unit-testable without React. Never imports `@/engine` directly — only the
 * store's already-display-ready `CohortStatusState` (the ui/engine boundary rule: UI
 * reaches the engine ONLY through `@/engine`'s barrel, and this is pure display logic
 * that needs none of it).
 */

import type { CohortStatusState } from "@/ui/store/gameStore";

export type SignalTone = "gray" | "amber" | "emerald" | "rose";

export interface SignalChipView {
  /** How many of the 4 bars are "lit" (1..4). */
  bars: number;
  tone: SignalTone;
  /** Chip should pulse (connecting/reconnecting/waiting — anything not settled). */
  pulsing: boolean;
}

/** RTT -> tone thresholds (design copy): emerald <120ms, amber <300ms, rose >=300ms.
 *  `null` (no sample yet) reads as neutral gray. Reused for per-member lag rows too
 *  (same thresholds applied to `lagTurns * TURN_MS`). */
export function rttTone(rttMs: number | null): SignalTone {
  if (rttMs === null) return "gray";
  if (rttMs < 120) return "emerald";
  if (rttMs < 300) return "amber";
  return "rose";
}

/** RTT -> lit bar count (4 = best). A known-but-poor RTT still shows 1 lit bar rather
 *  than 0 — "connected but bad" reads differently from "no signal at all". */
export function rttBars(rttMs: number | null): number {
  if (rttMs === null) return 1;
  if (rttMs < 120) return 4;
  if (rttMs < 300) return 3;
  if (rttMs < 600) return 2;
  return 1;
}

/**
 * The chip's full visual state for a given `cohortStatus` + current RTT sample.
 * `null` = render nothing (solo — not in a cohort, the overwhelming common case).
 */
/** Mirrors `engine/lockstep`'s `TURN_MS` (100ms/turn) as a plain display constant — the
 *  ui/ layer reaches the engine ONLY through `@/engine`'s barrel (which doesn't
 *  re-export lockstep internals), and this one number is stable/unlikely to drift
 *  unnoticed (a lockstep cadence change is a whole-system event, not a quiet tweak). */
export const TURN_MS_DISPLAY = 100;

export type MemberLagView = { kind: "caughtUp" } | { kind: "ms"; ms: number };

/** A member's lag row: `lagTurns` is clamped >=0 upstream (healthy peers send 2 turns
 *  ahead of the authority, which nets to 0 here) — "0ms" reads as broken/no-connection
 *  to a player, so caught-up peers get a distinct label instead of a bogus latency. */
export function formatMemberLag(lagTurns: number): MemberLagView {
  if (lagTurns <= 0) return { kind: "caughtUp" };
  return { kind: "ms", ms: lagTurns * TURN_MS_DISPLAY };
}

export function signalChipView(status: CohortStatusState, rttMs: number | null): SignalChipView | null {
  switch (status.kind) {
    case "solo":
      return null;
    case "connecting":
      return { bars: 1, tone: "gray", pulsing: true };
    case "reconnecting":
      return { bars: 1, tone: "amber", pulsing: true };
    case "waiting":
      return { bars: 1, tone: "amber", pulsing: true };
    case "active":
      return { bars: rttBars(rttMs), tone: rttTone(rttMs), pulsing: false };
  }
}
