"use client";

/**
 * The FTUE overlay: renders above the canvas (fixed, viewport-anchored),
 * never touches `engine/`/`render/`, and never blocks the rAF loop — it is
 * pure React/CSS reading only the throttled store snapshot (via
 * `useOnboardingController`) + DOM rects of `data-onboarding-anchor` targets.
 * All spotlight/bubble/mascot rendering itself lives in
 * `TutorialOverlayShell.tsx` (shared with `ContextualTipOverlay.tsx`, M4.8
 * card A/B) — this component only supplies FTUE-specific chrome: the
 * "N / total" step-progress badge and the skip-all/next button row.
 *
 * A "skip all" button is always rendered, independent of the current step's
 * dismiss rule (spec requirement — never trap a player in the flow).
 *
 * The `welcome` step's copy is class-aware (M5 Character Pivot): the player
 * arrives here having ALREADY created a character and picked a class on
 * `/characters`, so the greeting names it back — `className` is passed as an
 * ICU variable to EVERY step's `t()` call (harmless no-op for steps whose
 * message doesn't reference it).
 */

import { useTranslations } from "next-intl";
import { ONBOARDING_STEPS } from "@/ui/onboarding/steps";
import { TutorialOverlayShell } from "@/ui/onboarding/TutorialOverlayShell";
import { useOnboardingController } from "@/ui/onboarding/useOnboardingController";
import { useGameStore } from "@/ui/store/gameStore";

export function OnboardingOverlay() {
  const { stepIndex, tapNext, skip } = useOnboardingController();
  const t = useTranslations("onboarding");
  const tContent = useTranslations("content");
  const heroes = useGameStore((s) => s.heroes);

  const step = stepIndex >= 0 ? ONBOARDING_STEPS[stepIndex] : undefined;
  if (!step) return null;

  const current = stepIndex + 1;
  const total = ONBOARDING_STEPS.length;
  const showNext = step.advance.kind === "next";
  const className = heroes[0] ? tContent(`classes.${heroes[0].cls}.name`) : "";
  const title = t(`steps.${step.id}.title`, { className });

  return (
    <TutorialOverlayShell
      anchor={step.anchor}
      title={title}
      body={t(`steps.${step.id}.body`, { className })}
      mood={step.mood}
      ariaLabel={title}
      topRight={<span>{t("stepProgress", { current, total })}</span>}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skip}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-[11px] font-semibold text-ddp-ink-muted underline decoration-dotted underline-offset-2 hover:text-ddp-ink"
          >
            {t("skipAllButton")}
          </button>
          {showNext && (
            <button
              type="button"
              onClick={tapNext}
              className="min-h-9 rounded-(--ddp-radius-md) bg-emerald-400 px-4 py-1.5 text-xs font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-transform duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
            >
              {t("nextButton")}
            </button>
          )}
        </div>
      }
    />
  );
}
