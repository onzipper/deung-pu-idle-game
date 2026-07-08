"use client";

/**
 * React-side glue for contextual tutorial hooks (M4.8 card A) — the
 * progressive-disclosure counterpart to `useOnboardingController.ts`. Same
 * shape: all DECISION logic is the pure `resolveTriggeredTip` from `./tips.ts`
 * — this hook never re-implements it. It owns exactly two side effects:
 *
 *  1. Hydrate the persisted "seen tip ids" list from localStorage once, post-
 *     mount (same reasoning as `readStoredFtueCompleted`'s mount-effect
 *     correction — localStorage isn't available during SSR).
 *  2. On every throttled snapshot change, diff against the previous snapshot
 *     and ask the pure resolver whether a not-yet-seen tip's trigger just
 *     fired; if so, hold its id in local state until `dismiss()` is called.
 *
 * `activeTipId` is deliberately local `useState`, NOT a global store field —
 * nothing else in the app needs to read "is a tip showing right now" (same
 * reasoning as `CodexPanel`'s local open/close state).
 *
 * Gated on `ftueCompleted`: tips must NEVER fire while the linear FTUE is
 * still running (`useOnboardingController.ts` only flips this to `true` once
 * the FTUE finishes naturally OR is skipped), and at most one tip is shown at
 * a time.
 */

import { useEffect, useRef, useState } from "react";
import {
  CONTEXTUAL_TIPS,
  resolveTriggeredTip,
  tipById,
  type ContextualTipDef,
} from "@/ui/onboarding/tips";
import { FORTIFIER_TEMPLATES } from "@/engine";
import { toOnboardingSnapshot, type OnboardingSnapshot } from "@/ui/onboarding/steps";
import { readStoredSeenTips, useGameStore, writeSeenTip } from "@/ui/store/gameStore";

/** The "แกร่ง" fortifier template ids (`fort_weapon`/`fort_armor`) — read off
 * the engine's own catalog (`FORTIFIER_TEMPLATES`) rather than hardcoded, so
 * a future 3rd fortifier slot needs no change here. */
const FORTIFIER_TEMPLATE_IDS = new Set(Object.keys(FORTIFIER_TEMPLATES));

export interface ContextualTipController {
  /** The active tip def, or `undefined` when nothing should show. */
  tip: ContextualTipDef | undefined;
  /** Marks the active tip "seen" (persists so it never fires again) and hides it. */
  dismiss: () => void;
}

export function useContextualTips(): ContextualTipController {
  const hasSyncedOnce = useGameStore((s) => s.hasSyncedOnce);
  const ftueCompleted = useGameStore((s) => s.ftueCompleted);
  const gold = useGameStore((s) => s.gold);
  const stage = useGameStore((s) => s.stage);
  const kills = useGameStore((s) => s.kills);
  const phase = useGameStore((s) => s.phase);
  const autoCast = useGameStore((s) => s.autoCast);
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const autoHunt = useGameStore((s) => s.autoHunt);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const heroes = useGameStore((s) => s.heroes);
  // Owner-scoped guide (HOF/world-boss reward rewards): a UI-owned inventory
  // count, not engine state — see `OnboardingSnapshot.fortifierCount`'s doc.
  const fortifierCount = useGameStore(
    (s) => s.inventory.filter((i) => FORTIFIER_TEMPLATE_IDS.has(i.templateId)).length,
  );

  const snapshot = toOnboardingSnapshot({
    gold,
    stage,
    kills,
    phase,
    autoCast,
    autoAllocate,
    autoHunt,
    inTown,
    fortifierCount,
    heroes,
  });
  const prevSnapshotRef = useRef<OnboardingSnapshot>(snapshot);
  // `null` until the post-mount hydration effect below runs — guards against
  // ever writing a lost "seen" write back with a stale empty array.
  const seenRef = useRef<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    seenRef.current = readStoredSeenTips();
  }, []);

  useEffect(() => {
    const prev = prevSnapshotRef.current;
    prevSnapshotRef.current = snapshot;
    if (!hasSyncedOnce) return;
    if (!ftueCompleted) return; // never fire mid-FTUE (task requirement)
    if (activeId) return; // one tip on screen at a time
    if (!seenRef.current) return; // not hydrated from localStorage yet
    const triggered = resolveTriggeredTip(
      CONTEXTUAL_TIPS,
      new Set(seenRef.current),
      prev,
      snapshot,
    );
    if (triggered) setActiveId(triggered);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot fields are the intended deps; refs/functions are stable
  }, [
    gold,
    stage,
    kills,
    phase,
    autoCast,
    autoAllocate,
    autoHunt,
    inTown,
    fortifierCount,
    heroes,
    hasSyncedOnce,
    ftueCompleted,
    activeId,
  ]);

  function dismiss(): void {
    if (!activeId) return;
    seenRef.current = writeSeenTip(activeId, seenRef.current ?? readStoredSeenTips());
    setActiveId(null);
  }

  return { tip: activeId ? tipById(activeId) : undefined, dismiss };
}
