"use client";

/**
 * Reusable tap-to-show info tooltip (owner UX pass, 2026-07-07: "Concise copy +
 * ⓘ tooltips" — labels stay 2-4 Thai words, explanations live here instead).
 * Mobile-first by construction: NO hover-only affordance — a tap toggles the
 * bubble open/closed, and tapping anywhere else on the page closes it. The
 * visible glyph is small (a label-adjacent affordance, not a primary action),
 * but the real tap target is expanded to the house ≥44px minimum via an
 * absolutely-positioned invisible hit-area layer so it stays mobile-friendly
 * without the visual bulk of a full 44px circle next to short labels.
 *
 * Callers pass already-translated `text` (this component has no i18n
 * dependency of its own) — every call site is responsible for sourcing the
 * string from `messages/*.json` like any other player-facing copy.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface InfoTipProps {
  /** Already-translated hint body shown in the popover. */
  text: string;
  /** Optional accessible name override (defaults to a generic "more info"
   * label — see `common.infoTipAria`). */
  ariaLabel?: string;
}

export function InfoTip({ text, ariaLabel }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const t = useTranslations("common");

  // Tap-outside-to-close (mobile has no hover-out to rely on).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel ?? t("infoTipAria")}
        aria-expanded={open}
        className="relative grid h-5 w-5 place-items-center rounded-full border border-ddp-border-soft bg-black/30 text-[10px] leading-none font-bold text-ddp-ink-muted before:absolute before:-inset-3 before:content-[''] hover:text-ddp-ink active:scale-90"
      >
        <span aria-hidden>ⓘ</span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
        >
          {text}
        </span>
      )}
    </span>
  );
}
