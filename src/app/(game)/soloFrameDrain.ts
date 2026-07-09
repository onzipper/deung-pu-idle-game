/**
 * Zero-loss solo-frame input drain.
 *
 * Bug this fixes: the solo `frame()` branch used to call `store.drainPendingInput()`
 * UNCONDITIONALLY, then separately ask `drainAccumulator()` how many fixed sub-steps
 * to run this frame. `drainAccumulator` returns 0 whenever the accumulator's
 * `remainder` hasn't reached `FIXED_DT` (1/60s) yet — routine on 90/120/144Hz
 * displays (~8-11ms frames) and near-guaranteed on the FIRST rAF after boot. On a
 * 0-step frame the already-drained `PendingInput` was simply discarded: nothing
 * consumed it (the sub-step loop never ran), so the one-shot intent — a tap, or the
 * boot-time `queueSetAutoHunt(false)` — vanished for good.
 *
 * The fix: compute `steps` FIRST. Only drain the queue (removing it from the store)
 * when there's an actual sub-step this frame to hand it to; otherwise leave it
 * untouched in `pendingInput` so a LATER frame (once the accumulator crosses
 * `FIXED_DT`) delivers it. Pure — no store/engine imports beyond types, so this is
 * unit-testable without the Pixi/React graph (same rationale as `buildFrameInput.ts`).
 */

import { type Accumulator, drainAccumulator } from "@/engine";
import type { PendingInput } from "@/ui/store/gameStore";

export interface SoloFrameDrainResult {
  /** Fixed `FIXED_DT` sub-steps to run this frame (may be 0). */
  steps: number;
  /** The drained one-shot intent queue, or `null` when `steps === 0` — in which case
   * the queue was NOT drained and still holds whatever was queued (untouched). */
  pending: PendingInput | null;
}

export function drainSoloFrame(
  acc: Accumulator,
  elapsedSeconds: number,
  speed: number,
  drain: () => PendingInput,
): SoloFrameDrainResult {
  const steps = drainAccumulator(acc, elapsedSeconds, speed);
  if (steps === 0) return { steps, pending: null };
  return { steps, pending: drain() };
}
