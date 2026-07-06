/**
 * M7 Gear & Drops — pure drop-claim buffering (no React/DOM/fetch here; kept
 * headlessly testable, same philosophy as `ui/goalLadder.ts`/`ui/onboarding`).
 *
 * `GameClient.tsx`'s frame loop collects `itemDrop` events across sub-steps and
 * pushes one `ClaimBufferEntry` per drop into a closure-held buffer (NOT React/
 * Zustand state — it's per-frame-ish churn, same "never per-frame state in
 * React" rule as engine state itself). The buffer is flushed as a batched
 * POST /api/items/claim on the existing autosave cadence AND on tab-hide
 * (`sendBeacon`, best-effort — a lost buffer there is an accepted v1 tradeoff:
 * the claim is server-side idempotent via `claimKey`, so a retry is always
 * safe, but a truly lost beacon means a genuinely lost drop notification).
 */

export interface ClaimBufferEntry {
  /** The engine's per-save monotonic loot-counter value for this roll (stable
   * claim identity — see `docs/persistence-m7.md`'s claimKey design). */
  rollId: string;
  templateId: string;
  /** Content stage at the moment of the kill (server validates membership). */
  stage: number;
}

/**
 * Appends `entry`, deduping by `rollId` (defensive: the engine's loot counter
 * is monotonic so a legit duplicate shouldn't occur within one session, but a
 * caller re-dispatch bug must never double-send the same roll). Returns a NEW
 * array — pure, no mutation of `buffer`.
 */
export function pushClaim(
  buffer: readonly ClaimBufferEntry[],
  entry: ClaimBufferEntry,
): ClaimBufferEntry[] {
  if (buffer.some((e) => e.rollId === entry.rollId)) return buffer.slice();
  return [...buffer, entry];
}

/**
 * Splits off up to `cap` entries to send in the next batch, returning both the
 * batch and the still-queued remainder (a buffer bigger than `cap` flushes
 * across multiple cadence ticks rather than being truncated/dropped).
 */
export function takeBatch(
  buffer: readonly ClaimBufferEntry[],
  cap: number,
): { batch: ClaimBufferEntry[]; remaining: ClaimBufferEntry[] } {
  return { batch: buffer.slice(0, cap), remaining: buffer.slice(cap) };
}
