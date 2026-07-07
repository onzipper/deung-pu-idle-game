"use client";

/**
 * React-side glue for the "what's new" patch-notes modal (UAT task) — same
 * shape as `onboarding/useOnboardingController.ts`'s gate-in effect: all
 * DECISION logic is the pure `resolvePatchNotesDecision` from
 * `ui/patchNotes.ts`; this hook never re-implements it. Fires once, the
 * first time we have a real synced snapshot (`hasSyncedOnce` — same gate
 * onboarding/tips use, so the store's hardcoded initial values never look
 * "fresh" for a returning player for one instant).
 *
 * `patchNotesVisible` is a store field flipped via plain store ACTIONS
 * (`showPatchNotes`/`dismissPatchNotes`), not a raw component `useState`
 * setter called from inside the effect — same "gate runs once" shape as
 * `useOnboardingController`'s `startOnboarding`/`completeOnboarding` calls.
 */

import { useEffect, useRef } from "react";
import { isFreshSave, toOnboardingSnapshot } from "@/ui/onboarding/steps";
import { LATEST_PATCH_NOTES_ID, resolvePatchNotesDecision } from "@/ui/patchNotes";
import {
  readStoredFtueCompleted,
  readStoredSeenPatchNotes,
  useGameStore,
  writeSeenPatchNotes,
} from "@/ui/store/gameStore";

export interface PatchNotesController {
  show: boolean;
  /** Marks the latest release "seen" (persists) and hides the modal. */
  acknowledge: () => void;
}

export function usePatchNotes(): PatchNotesController {
  const hasSyncedOnce = useGameStore((s) => s.hasSyncedOnce);
  const gold = useGameStore((s) => s.gold);
  const stage = useGameStore((s) => s.stage);
  const kills = useGameStore((s) => s.kills);
  const phase = useGameStore((s) => s.phase);
  const autoCast = useGameStore((s) => s.autoCast);
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const autoHunt = useGameStore((s) => s.autoHunt);
  const heroes = useGameStore((s) => s.heroes);
  const show = useGameStore((s) => s.patchNotesVisible);
  const showPatchNotes = useGameStore((s) => s.showPatchNotes);
  const dismissPatchNotes = useGameStore((s) => s.dismissPatchNotes);

  const gatedRef = useRef(false);

  useEffect(() => {
    if (gatedRef.current) return;
    if (!hasSyncedOnce) return;
    gatedRef.current = true;

    const snapshot = toOnboardingSnapshot({
      gold,
      stage,
      kills,
      phase,
      autoCast,
      autoAllocate,
      autoHunt,
      // `inTown` doesn't affect `isFreshSave` (the only helper this snapshot
      // feeds here) — a fixed value keeps this call site simple.
      inTown: false,
      heroes,
    });
    // Same "returning player, but the FTUE flag hasn't been corrected yet"
    // heuristic as `useOnboardingController`'s own gate: a fresh save AND an
    // uncompleted persisted FTUE flag together mean this is a brand-new
    // character about to see the FTUE — never stack this modal on top of it.
    const isBrandNew = !readStoredFtueCompleted() && isFreshSave(snapshot);

    const decision = resolvePatchNotesDecision({
      seenId: readStoredSeenPatchNotes(),
      latestId: LATEST_PATCH_NOTES_ID,
      isBrandNew,
    });

    if (decision === "show") showPatchNotes();
    else if (decision === "recordOnly") writeSeenPatchNotes(LATEST_PATCH_NOTES_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gate runs once, deliberately reads latest snapshot via closure
  }, [hasSyncedOnce]);

  function acknowledge(): void {
    writeSeenPatchNotes(LATEST_PATCH_NOTES_ID);
    dismissPatchNotes();
  }

  return { show, acknowledge };
}
