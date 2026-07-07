"use client";

/**
 * M8 Phase 1 "Friends" — console-dock entry point AND the hub component: it
 * owns the single `useFriendsPoll` instance (see that hook's doc for the
 * cadence contract) and threads it down to the badge, the always-mounted
 * emoji-ping toasts, and the on-demand `FriendsPanel` — so opening/closing
 * the panel never spins up a second poller. Same local `useState` open/close
 * idiom as every other dock trigger (`HallOfFameButton.tsx`, `CodexButton.tsx`).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FriendsPanel } from "@/ui/friends/FriendsPanel";
import { useFriendsPoll, type FriendToast } from "@/ui/friends/useFriendsPoll";

function PingToast({ toast, onDismiss }: { toast: FriendToast; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="animate-buy-pulse pointer-events-auto flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/80 px-3 py-1.5 text-xs font-bold text-ddp-ink shadow-(--ddp-shadow-btn)"
    >
      <span aria-hidden className="text-base">
        {toast.emoji}
      </span>
      <span className="truncate">{toast.fromDisplayName ?? "???"}</span>
    </button>
  );
}

export function FriendsButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("friends");
  const poll = useFriendsPoll(open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        <span aria-hidden>{"\u{1F465}"}</span> {t("openButton")}
        {poll.status === "ready" && poll.pendingCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ddp-bad px-1 text-[10px] font-black text-white"
          >
            {poll.pendingCount > 9 ? "9+" : poll.pendingCount}
          </span>
        )}
      </button>

      {poll.toasts.length > 0 && (
        <div className="pointer-events-none fixed top-14 left-1/2 z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {poll.toasts.map((toast) => (
            <PingToast key={toast.id} toast={toast} onDismiss={() => poll.dismissToast(toast.id)} />
          ))}
        </div>
      )}

      {open && <FriendsPanel poll={poll} onClose={() => setOpen(false)} />}
    </>
  );
}
