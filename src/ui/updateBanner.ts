/**
 * Mid-session "new patch deployed" banner (owner-approved feature) — same
 * shape/testability contract as `ui/patchNotes.ts`: pure TS (no React/DOM), so
 * the show/hide decision is headlessly testable
 * (`__tests__/updateBanner.test.ts`). `UpdateBanner.tsx` is the only React
 * glue; `GameClient.tsx` owns the transport (piggybacked on the existing
 * autosave POST/boot GET responses — see `@/server/buildId`) and the
 * flush-then-reload side effect.
 *
 * Transport: zero extra requests. The client already POSTs `/api/save` on the
 * autosave cadence (and GETs it once at boot); the server now stamps its own
 * build id onto BOTH responses (`@/server/buildId`'s `currentBuildId()`). The
 * client compares that against `CLIENT_BUILD_ID` (this module's own inlined
 * `NEXT_PUBLIC_BUILD_ID`, baked in at build time by `next.config.ts`) on every
 * response.
 */

/** This client's own build id, inlined at build time (see `next.config.ts` /
 * `src/lib/buildId.ts`). A pure module constant (not read inside a function)
 * so it's still trivially the SAME reference `resolveUpdateBannerDecision`'s
 * callers pass in — kept here rather than duplicated in the hook/component. */
export const CLIENT_BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Dismiss cool-down: a dismissed banner reappears once this many ms have
 * elapsed since the dismiss (owner spec: "~30 min"), for the SAME mismatched
 * server build id — a NEWER deploy landing during the cooldown always shows
 * immediately (see `resolveUpdateBannerDecision`). */
export const DISMISS_COOLDOWN_MS = 30 * 60 * 1000;

export interface UpdateBannerDecisionInput {
  /** This client's own inlined build id (pass `CLIENT_BUILD_ID` in real use;
   * parameterized so this stays headlessly testable against arbitrary ids). */
  clientBuildId: string;
  /** The build id read off the latest `/api/save` response, or `null` before
   * the first one has landed (nothing to compare against yet). */
  serverBuildId: string | null;
  /** The server build id the LAST dismiss was recorded against, or `null` if
   * never dismissed (or the mismatch has since moved to a different id). */
  dismissedForId: string | null;
  /** Wall-clock ms the banner was last dismissed at, or `null`. */
  dismissedAt: number | null;
  /** Wall-clock "now" (parameterized for testability). */
  now: number;
}

export type UpdateBannerDecision = "show" | "hide";

/**
 * - No mismatch yet (server id unknown, or matches this client's own id) ->
 *   "hide" — nothing to announce.
 * - A NEW mismatch (server id differs from both the client AND whatever the
 *   last dismiss was recorded against) -> "show", even if an older dismiss
 *   window is still technically open (a newer deploy always interrupts it).
 * - The SAME mismatch, not yet dismissed -> "show".
 * - The SAME mismatch, dismissed within `DISMISS_COOLDOWN_MS` -> "hide".
 * - The SAME mismatch, dismissed longer than `DISMISS_COOLDOWN_MS` ago ->
 *   "show" again (owner spec: "reappear after ~30 min").
 */
export function resolveUpdateBannerDecision(
  input: UpdateBannerDecisionInput,
): UpdateBannerDecision {
  const { clientBuildId, serverBuildId, dismissedForId, dismissedAt, now } = input;
  if (!serverBuildId || serverBuildId === clientBuildId) return "hide";

  const dismissedThisMismatch = dismissedForId === serverBuildId && dismissedAt !== null;
  if (dismissedThisMismatch && now - (dismissedAt as number) < DISMISS_COOLDOWN_MS) {
    return "hide";
  }
  return "show";
}
