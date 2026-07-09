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
import { FriendsIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { FriendsPanel } from "@/ui/friends/FriendsPanel";
import { useFriendsPoll, type FriendToast } from "@/ui/friends/useFriendsPoll";

function PingToast({
  toast,
  label,
  onDismiss,
  onOpenPanel,
}: {
  toast: FriendToast;
  /** Action line for the ACTIONABLE kinds (party invite / friend request);
   * null for a plain emoji ping. */
  label: string | null;
  onDismiss: () => void;
  /** Actionable toasts open the friends panel on tap (realtime ask 2026-07-08:
   * the player should be able to act without hunting for the menu). */
  onOpenPanel: () => void;
}) {
  const actionable = toast.kind !== "emoji";
  return (
    <button
      type="button"
      onClick={() => {
        onDismiss();
        if (actionable) onOpenPanel();
      }}
      className={`animate-buy-pulse pointer-events-auto flex items-center gap-2 rounded-(--ddp-radius-md) border px-3 py-1.5 text-xs font-bold text-ddp-ink shadow-(--ddp-shadow-btn) ${
        actionable ? "border-amber-400/50 bg-black/85" : "border-ddp-border-soft bg-black/80"
      }`}
    >
      <span aria-hidden className="text-base">
        {toast.emoji}
      </span>
      <span className="truncate">{toast.fromDisplayName ?? "???"}</span>
      {label && <span className="whitespace-nowrap text-ddp-ink-muted">{label}</span>}
    </button>
  );
}

export function FriendsButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("friends");
  const poll = useFriendsPoll(open);

  return (
    <>
      <IconTileButton
        icon={<FriendsIcon className="h-5 w-5" />}
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
        badge={
          poll.status === "ready" && poll.pendingCount > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ddp-bad px-1 text-[10px] font-black text-white"
            >
              {poll.pendingCount > 9 ? "9+" : poll.pendingCount}
            </span>
          ) : undefined
        }
      />

      {poll.toasts.length > 0 && (
        <div className="pointer-events-none fixed top-14 left-1/2 z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {poll.toasts.map((toast) => (
            <PingToast
              key={toast.id}
              toast={toast}
              label={
                toast.kind === "partyInvite"
                  ? t("toastPartyInvite")
                  : toast.kind === "friendRequest"
                    ? t("toastFriendRequest")
                    : null
              }
              onDismiss={() => poll.dismissToast(toast.id)}
              onOpenPanel={() => setOpen(true)}
            />
          ))}
        </div>
      )}

      {open && <FriendsPanel poll={poll} onClose={() => setOpen(false)} />}
    </>
  );
}
