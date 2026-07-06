"use client";

/**
 * M7.5 generic notice toasts — same store-driven, capped, oldest-first shape
 * as `DropFeed.tsx` but for plain i18n-keyed one-liners (fast-travel blocked
 * reasons, auto-sell trip results) rather than an item mint. Stacks BELOW the
 * drop-feed toasts (both are fixed/top, non-interactive).
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useGameStore, type NoticeEntry } from "@/ui/store/gameStore";

const DISPLAY_MS = 3200;

function Notice({ entry }: { entry: NoticeEntry }) {
  const dismiss = useGameStore((s) => s.dismissNotice);
  const t = useTranslations("notices");

  useEffect(() => {
    const timer = setTimeout(() => dismiss(entry.id), DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry`/`dismiss` are stable per mount
  }, []);

  return (
    <div className="animate-buy-pulse pointer-events-none rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/80 px-3 py-1.5 text-xs font-bold text-ddp-ink shadow-(--ddp-shadow-btn)">
      {t(entry.messageKey, entry.params)}
    </div>
  );
}

export function NoticeToast() {
  const notices = useGameStore((s) => s.notices);
  if (notices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {notices.map((entry) => (
        <Notice key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
