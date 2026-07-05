"use client";

/**
 * Renders the single active contextual tip (M4.8 card A/B), if any, using the
 * SAME spotlight/bubble chrome as the FTUE (`TutorialOverlayShell.tsx`).
 * Decision logic (which tip, once-only persistence, the `ftueCompleted` gate)
 * lives entirely in `useContextualTips.ts`; this component only presents it
 * with a simple "got it" dismiss — no progress counter/skip-all (those are
 * FTUE-only concepts), since each tip is already a single, self-contained
 * beat that never re-fires.
 *
 * Mounted once in `GameHud.tsx`, alongside (never simultaneously active with,
 * by construction — see the `ftueCompleted` gate) `OnboardingOverlay`.
 */

import { useTranslations } from "next-intl";
import { TutorialOverlayShell } from "@/ui/onboarding/TutorialOverlayShell";
import { useContextualTips } from "@/ui/onboarding/useContextualTips";

export function ContextualTipOverlay() {
  const { tip, dismiss } = useContextualTips();
  const t = useTranslations("onboarding");

  if (!tip) return null;

  const title = t(`tips.${tip.id}.title`);

  return (
    <TutorialOverlayShell
      anchor={tip.anchor}
      title={title}
      body={t(`tips.${tip.id}.body`)}
      mood={tip.mood}
      ariaLabel={title}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="min-h-9 rounded-(--ddp-radius-md) bg-emerald-400 px-4 py-1.5 text-xs font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-transform duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
          >
            {t("tipDismissButton")}
          </button>
        </div>
      }
    />
  );
}
