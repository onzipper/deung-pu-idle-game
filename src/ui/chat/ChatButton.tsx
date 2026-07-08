"use client";

/**
 * M8 party Wave 3 "global chat" (docs/ghost-presence-design.md) — the floating trigger
 * + unread badge. `chatOpen` lives in the STORE (not local `useState`, unlike every
 * other HUD modal trigger) because `GameClient.tsx` also reacts to it — opening the
 * panel keeps the world socket alive for chat even while ghost-presence is off (see
 * `syncWorldSessionActive`'s doc). Fixed-position (not portaled — only the PANEL needs
 * `ModalPortal`'s iOS Safari fix, same convention as `FriendsButton.tsx`'s badge/toast
 * living directly in the tree while `FriendsPanel` alone is portaled). Positioned
 * mobile: bottom-left, ABOVE the console dock; desktop: right edge, mid-height — must
 * never cover `SkillBar`/`WalkControls` on either breakpoint.
 */

import { useTranslations } from "next-intl";
import { ChatPanel } from "@/ui/chat/ChatPanel";
import { useGameStore } from "@/ui/store/gameStore";

export function ChatButton() {
  const t = useTranslations("chat");
  const chatOpen = useGameStore((s) => s.chatOpen);
  const chatUnread = useGameStore((s) => s.chatUnread);
  const setChatOpen = useGameStore((s) => s.setChatOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => setChatOpen(!chatOpen)}
        aria-label={t("openButton")}
        aria-expanded={chatOpen}
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-3 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-ddp-border bg-ddp-panel-strong text-lg shadow-(--ddp-shadow-btn) transition-transform duration-100 active:scale-95 sm:top-1/2 sm:right-3 sm:bottom-auto sm:left-auto sm:-translate-y-1/2"
      >
        <span aria-hidden>{"\u{1F4AC}"}</span>
        {chatUnread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/80 px-1 text-[8px] font-bold tabular-nums text-ddp-gold-bright"
          >
            {chatUnread > 9 ? "9+" : chatUnread}
          </span>
        )}
      </button>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </>
  );
}
