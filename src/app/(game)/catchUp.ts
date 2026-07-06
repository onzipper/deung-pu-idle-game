/**
 * Pure helper for the "backgrounded tab" catch-up feature (owner request
 * 2026-07-xx): when the player returns to a hidden tab / unfolds the screen,
 * the hidden wall-clock gap should be replayed through the engine instead of
 * silently lost to the rAF loop's per-frame `MAX_FRAME_SECONDS` clamp.
 *
 * This module ONLY turns an elapsed wall-clock gap into a step count — no
 * DOM, no engine import, no wall-clock reads. `GameClient.tsx` is the one
 * place that reads `Date.now()`/`document.visibilityState` and drives the
 * actual `step()` loop (same "boundary reads the clock, pure code doesn't"
 * shape as the rest of the engine seam — see `engine/README.md`).
 */

export interface CatchUpCaps {
  /** Seconds simulated per engine `step()` (the engine's `FIXED_DT`). */
  fixedDtSeconds: number;
  /** Same cap the boot offline-idle replay uses (`CONFIG.offlineCapHours`). */
  capHours: number;
}

export interface CatchUpResult {
  /** Number of `step()` calls to replay (already capped). */
  steps: number;
  /** Whether the raw hidden gap exceeded `capHours` and was clamped. */
  capped: boolean;
}

/**
 * Turns a hidden-tab wall-clock gap into a bounded number of fixed-step
 * replays, mirroring the boot offline-idle replay's own capping rule
 * (`Math.floor(offlineSeconds / FIXED_DT)`, capped at `offlineCapHours`).
 *
 * Returns `{ steps: 0, capped: false }` for a non-finite/non-positive gap so
 * callers can unconditionally check `steps > 0` without a separate guard.
 */
export function resolveCatchUp(elapsedMs: number, caps: CatchUpCaps): CatchUpResult {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { steps: 0, capped: false };
  const capMs = caps.capHours * 3_600_000;
  const capped = elapsedMs > capMs;
  const cappedMs = Math.min(elapsedMs, capMs);
  const steps = Math.floor(cappedMs / 1000 / caps.fixedDtSeconds);
  return { steps, capped };
}
