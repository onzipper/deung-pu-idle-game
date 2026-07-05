"use client";

/**
 * Shared spotlight + speech-bubble chrome for BOTH the linear FTUE
 * (`OnboardingOverlay.tsx`) and one-off contextual tips
 * (`ContextualTipOverlay.tsx`, M4.8 card A/B) — the "reuse the same
 * overlay/tooltip rendering" requirement from the task brief, factored out of
 * what was originally `OnboardingOverlay.tsx` alone. Everything DECISION-
 * related (which step/tip is active, when to advance/dismiss, persistence)
 * stays in each caller's own controller hook; this component only knows how
 * to position and draw one anchored (or centered) bubble, with a mascot in
 * the slot next to the title.
 *
 * Two visual modes (unchanged from the original):
 *  - Anchored (`anchor` resolves to a DOM rect): four dimming panels form a
 *    "cutout" frame around the target rect (so the spotlighted control keeps
 *    receiving real clicks) plus a pulsing ring traced exactly around it.
 *  - Unanchored (no `anchor`, or its target isn't mounted): a single full-
 *    bleed dim modal, tooltip centered.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MascotMood } from "@/ui/onboarding/mascotMood";
import { Mascot } from "@/ui/onboarding/Mascot";
import type { OnboardingAnchor } from "@/ui/onboarding/steps";
import { useAnchorRect } from "@/ui/onboarding/useAnchorRect";

const MARGIN = 12;
const GAP = 14;
const SPOTLIGHT_PAD = 6;

interface BubblePos {
  left: number;
  top: number;
}

export interface TutorialOverlayShellProps {
  anchor: OnboardingAnchor | undefined;
  title: string;
  body: string;
  ariaLabel: string;
  /** Mascot pose for this dialogue; omitted defaults to "neutral" (see `Mascot.tsx`). */
  mood?: MascotMood;
  /** Small chrome above the title (e.g. FTUE's "3 / 7" step counter). Omitted
   * for callers that don't need it (contextual tips). */
  topRight?: ReactNode;
  /** Action row under the body (buttons differ per caller: FTUE's skip/next
   * vs. a tip's single "got it" dismiss). */
  footer: ReactNode;
}

export function TutorialOverlayShell({
  anchor,
  title,
  body,
  ariaLabel,
  mood = "neutral",
  topRight,
  footer,
}: TutorialOverlayShellProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<BubblePos | null>(null);
  const rect = useAnchorRect(anchor);

  useLayoutEffect(() => {
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
    // Recomputed on every anchor/title/rect change; `rect` is a fresh DOMRect
    // each poll tick (see useAnchorRect), so this also self-corrects on resize.
  }, [anchor, title, rect]);

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
        aria-label={ariaLabel}
        className="animate-onboarding-in pointer-events-auto absolute w-[min(88vw,20rem)] rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {topRight && (
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
            {topRight}
          </div>
        )}
        <div className="flex items-start gap-2.5">
          <Mascot mood={mood} />
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 text-sm font-extrabold text-ddp-gold-bright">{title}</h3>
            <p className="mb-3 text-[13px] leading-snug text-ddp-ink">{body}</p>
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
