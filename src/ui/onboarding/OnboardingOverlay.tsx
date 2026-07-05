"use client";

/**
 * The FTUE overlay: renders above the canvas (fixed, viewport-anchored),
 * never touches `engine/`/`render/`, and never blocks the rAF loop — it is
 * pure React/CSS reading only the throttled store snapshot + DOM rects of
 * `data-onboarding-anchor` targets (see `useAnchorRect.ts`).
 *
 * Two visual modes:
 *  - Anchored step (`step.anchor` set): four dimming panels form a "cutout"
 *    frame around the target rect (so the spotlighted control keeps
 *    receiving real clicks — nothing overlays it) plus a pulsing ring
 *    (`animate-onboarding-ring`) traced exactly around it.
 *  - Unanchored step (welcome/outro): a single full-bleed dim modal, tooltip
 *    centered.
 *
 * A "skip all" button is always rendered, independent of the current step's
 * dismiss rule (spec requirement — never trap a player in the flow).
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ONBOARDING_STEPS } from "@/ui/onboarding/steps";
import { useAnchorRect } from "@/ui/onboarding/useAnchorRect";
import { useOnboardingController } from "@/ui/onboarding/useOnboardingController";

const MARGIN = 12;
const GAP = 14;
const SPOTLIGHT_PAD = 6;

interface BubblePos {
  left: number;
  top: number;
}

export function OnboardingOverlay() {
  const { stepIndex, tapNext, skip } = useOnboardingController();
  const t = useTranslations("onboarding");
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<BubblePos | null>(null);

  const step = stepIndex >= 0 ? ONBOARDING_STEPS[stepIndex] : undefined;
  const rect = useAnchorRect(step?.anchor);

  useLayoutEffect(() => {
    if (!step) return;
    const w = bubbleRef.current?.offsetWidth ?? 300;
    const h = bubbleRef.current?.offsetHeight ?? 140;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
      setPos({ left: (vw - w) / 2, top: (vh - h) / 2 });
      return;
    }
    const centerX = rect.left + rect.width / 2;
    const left = Math.max(MARGIN, Math.min(centerX - w / 2, vw - w - MARGIN));
    const spaceBelow = vh - rect.bottom;
    const below = spaceBelow > h + GAP + MARGIN;
    const top = below
      ? Math.min(rect.bottom + GAP, vh - h - MARGIN)
      : Math.max(MARGIN, rect.top - GAP - h);
    setPos({ left, top });
    // Recomputed on every step/rect change; `rect` is a fresh DOMRect each
    // poll tick (see useAnchorRect), so this also self-corrects on resize.
  }, [step, rect]);

  if (!step) return null;

  const current = stepIndex + 1;
  const total = ONBOARDING_STEPS.length;
  const showNext = step.advance.kind === "next";

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
      {rect ? (
        <>
          <div
            className="pointer-events-auto absolute inset-x-0 top-0 bg-black/65 transition-[height] duration-150"
            style={{ height: Math.max(0, rect.top - SPOTLIGHT_PAD) }}
          />
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 bg-black/65 transition-[top] duration-150"
            style={{ top: rect.bottom + SPOTLIGHT_PAD }}
          />
          <div
            className="pointer-events-auto absolute bg-black/65"
            style={{
              top: Math.max(0, rect.top - SPOTLIGHT_PAD),
              left: 0,
              width: Math.max(0, rect.left - SPOTLIGHT_PAD),
              height: rect.height + SPOTLIGHT_PAD * 2,
            }}
          />
          <div
            className="pointer-events-auto absolute bg-black/65"
            style={{
              top: Math.max(0, rect.top - SPOTLIGHT_PAD),
              left: rect.right + SPOTLIGHT_PAD,
              right: 0,
              height: rect.height + SPOTLIGHT_PAD * 2,
            }}
          />
          <div
            aria-hidden
            className="animate-onboarding-ring pointer-events-none absolute rounded-(--ddp-radius-md) border-2 border-ddp-gold/80"
            style={{
              top: rect.top - SPOTLIGHT_PAD,
              left: rect.left - SPOTLIGHT_PAD,
              width: rect.width + SPOTLIGHT_PAD * 2,
              height: rect.height + SPOTLIGHT_PAD * 2,
            }}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/70" />
      )}

      <div
        ref={bubbleRef}
        role="dialog"
        aria-label={t(`steps.${step.id}.title`)}
        className="animate-onboarding-in pointer-events-auto absolute w-[min(88vw,20rem)] rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
          <span>{t("stepProgress", { current, total })}</span>
        </div>
        <h3 className="mb-1 text-sm font-extrabold text-ddp-gold-bright">
          {t(`steps.${step.id}.title`)}
        </h3>
        <p className="mb-3 text-[13px] leading-snug text-ddp-ink">
          {t(`steps.${step.id}.body`)}
        </p>
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
      </div>
    </div>
  );
}
