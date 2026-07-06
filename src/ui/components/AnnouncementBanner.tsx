"use client";

/**
 * M7.9 server-wide high-refine announcement banner. Owner directive: this
 * must read MORE prominent/special than `DropFeed`/`NoticeToast` ("เด่น ๆ
 * และดูพิเศษกว่าหน่อย") — so unlike those two (small, centered, stacked
 * toasts), this is a full-width slim strip that slides down from the very
 * top of the viewport, holds, then slides back out. One at a time: a burst
 * of server-wide landings QUEUES (`announcementQueue` in the store) and
 * staggers rather than stacking simultaneously.
 *
 * `key={current.id}` remounts the div per entry (same "restart an animation
 * via key-remount" convention as `FastTravelChannelBar.tsx`'s fill bar) so
 * the single self-timed `ddp-announce-banner` keyframe (slide-in -> hold ->
 * slide-out, ~`DISPLAY_MS`) always starts fresh. `pointer-events-none` at the
 * wrapper (same as `DropFeed`/`NoticeToast`) so it never blocks a tap on the
 * HUD underneath, even mid-animation.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useGameStore } from "@/ui/store/gameStore";

/** Wall-clock display duration — matches the CSS animation's total length
 * (`globals.css`'s `ddp-announce-banner`, 5s) so the queue advances right as
 * the slide-out finishes. */
const DISPLAY_MS = 5000;

export function AnnouncementBanner() {
  const current = useGameStore((s) => s.announcementQueue[0] ?? null);
  const shift = useGameStore((s) => s.shiftAnnouncementQueue);
  const t = useTranslations("announcements");
  const tContent = useTranslations("content.items");

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => shift(), DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shift` is a stable store action; re-run only when the entry changes
  }, [current?.id]);

  if (!current) return null;

  const itemName = tContent(`${current.templateId}.name`);
  const isMax = current.refineLevel >= 10;

  return (
    <div
      key={current.id}
      aria-live="polite"
      className="animate-ddp-announce-banner pointer-events-none fixed inset-x-0 top-0 z-75 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-b-(--ddp-radius-md) border border-ddp-gold bg-gradient-to-r from-ddp-panel-strong via-black/90 to-ddp-panel-strong px-4 py-2 text-center shadow-[0_6px_28px_-6px_rgba(242,177,52,0.6)]">
        {/* Gold shimmer sweep — richer than DropFeed/NoticeToast's plain pulse. */}
        <span
          aria-hidden
          className="animate-ddp-announce-shimmer pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
        />
        <span className="relative text-sm font-black text-ddp-gold-bright sm:text-base">
          {t(isMax ? "landedMax" : "landed", {
            charName: current.charName,
            itemName,
            level: current.refineLevel,
          })}
        </span>
      </div>
    </div>
  );
}
