"use client";

/**
 * M7.5 generic notice toasts — same store-driven, capped, oldest-first shape
 * as `DropFeed.tsx` but for plain i18n-keyed one-liners (fast-travel blocked
 * reasons, auto-sell trip results) rather than an item mint.
 *
 * R2-W2 "fullscreen HUD": moved from a fixed top-of-viewport stack to the
 * bottom overlay, just above the skill dock (`GameHud.tsx`'s bottom region) —
 * the mockup keeps transient status text near the action bar the player's
 * thumb/eyes are already on, not up by the epic-drop `DropFeed` toasts.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Toast } from "@/ui/components/primitives/Toast";
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
    <Toast variant="info" onDismiss={() => dismiss(entry.id)}>
      {t(entry.messageKey, entry.params)}
    </Toast>
  );
}

export function NoticeToast() {
  const notices = useGameStore((s) => s.notices);
  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {notices.map((entry) => (
        <Notice key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
