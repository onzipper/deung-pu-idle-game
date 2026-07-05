"use client";

/**
 * React-side glue for the onboarding framework. Owns exactly two side
 * effects; all DECISION logic is the pure `resolveNextStepIndex`/`isFreshSave`
 * from `./steps.ts` — this hook never re-implements it:
 *
 *  1. Gate-in: once the first throttled engine snapshot has arrived
 *     (`hasSyncedOnce`), start the FTUE iff the player hasn't completed it
 *     before (persisted `ftueCompleted`) AND the snapshot looks like a fresh
 *     save (`isFreshSave`) — a returning player (any prior progress) must
 *     never see it, even on their very first session after this feature ships.
 *  2. Auto-advance: on every throttled snapshot change while a step is
 *     active, diff against the previous snapshot and ask the pure resolver
 *     whether to move on (action/auto-kind steps) — no player tap involved.
 *
 * `tapNext()`/`skip()` are the only two calls the overlay component makes
 * back into this module for explicit-button-kind steps.
 */

import { useEffect, useRef } from "react";
import {
  ONBOARDING_STEPS,
  isFreshSave,
  resolveNextStepIndex,
  toOnboardingSnapshot,
  type OnboardingSnapshot,
} from "@/ui/onboarding/steps";
import { readStoredFtueCompleted, useGameStore } from "@/ui/store/gameStore";

export interface OnboardingController {
  /** -1 when inactive; otherwise the live index into `ONBOARDING_STEPS`. */
  stepIndex: number;
  /** Advance an explicit "next"-kind step (no-op otherwise). */
  tapNext: () => void;
  /** Skip-all: ends the FTUE immediately and persists so it never returns. */
  skip: () => void;
}

export function useOnboardingController(): OnboardingController {
  const hasSyncedOnce = useGameStore((s) => s.hasSyncedOnce);
  const ftueCompleted = useGameStore((s) => s.ftueCompleted);
  const stepIndex = useGameStore((s) => s.onboardingStepIndex);
  const gold = useGameStore((s) => s.gold);
  const stage = useGameStore((s) => s.stage);
  const kills = useGameStore((s) => s.kills);
  const phase = useGameStore((s) => s.phase);
  const autoCast = useGameStore((s) => s.autoCast);
  const heroes = useGameStore((s) => s.heroes);
  const startOnboarding = useGameStore((s) => s.startOnboarding);
  const setOnboardingStepIndex = useGameStore((s) => s.setOnboardingStepIndex);
  const completeOnboarding = useGameStore((s) => s.completeOnboarding);
  const setFtueCompleted = useGameStore((s) => s.setFtueCompleted);

  const snapshot = toOnboardingSnapshot({
    gold,
    stage,
    kills,
    phase,
    autoCast,
    heroes,
  });
  const prevSnapshotRef = useRef<OnboardingSnapshot>(snapshot);
  const gatedRef = useRef(false);

  // Mount-effect-only: correct the persisted flag AFTER hydration, same
  // reasoning as `SoundToggle`'s `setSoundMuted(readStoredSoundMuted())`.
  useEffect(() => {
    setFtueCompleted(readStoredFtueCompleted());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  // Gate-in: fires once, the first time we have both a real synced snapshot
  // AND the corrected persisted flag.
  useEffect(() => {
    if (gatedRef.current) return;
    if (!hasSyncedOnce) return;
    if (ftueCompleted) {
      gatedRef.current = true;
      return;
    }
    if (stepIndex >= 0) {
      gatedRef.current = true; // already running (e.g. HMR/fast refresh)
      return;
    }
    gatedRef.current = true;
    if (isFreshSave(snapshot)) startOnboarding();
    else completeOnboarding(); // returning player heuristic: never show it, and stop re-checking
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gate runs once, deliberately reads latest snapshot via closure
  }, [hasSyncedOnce, ftueCompleted]);

  // Auto-advance: diff consecutive snapshots through the pure resolver.
  useEffect(() => {
    const prev = prevSnapshotRef.current;
    prevSnapshotRef.current = snapshot;
    if (stepIndex < 0) return;
    const nextIndex = resolveNextStepIndex(
      ONBOARDING_STEPS,
      stepIndex,
      prev,
      snapshot,
      false,
    );
    if (nextIndex === stepIndex) return;
    if (nextIndex >= ONBOARDING_STEPS.length) completeOnboarding();
    else setOnboardingStepIndex(nextIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot fields are the intended deps; functions are stable store actions
  }, [gold, stage, kills, phase, autoCast, heroes, stepIndex]);

  function tapNext(): void {
    if (stepIndex < 0) return;
    const prev = prevSnapshotRef.current;
    const nextIndex = resolveNextStepIndex(
      ONBOARDING_STEPS,
      stepIndex,
      prev,
      snapshot,
      true,
    );
    if (nextIndex === stepIndex) return;
    if (nextIndex >= ONBOARDING_STEPS.length) completeOnboarding();
    else setOnboardingStepIndex(nextIndex);
  }

  function skip(): void {
    completeOnboarding();
  }

  return { stepIndex, tapNext, skip };
}
