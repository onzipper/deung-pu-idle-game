"use client";

/**
 * M8 party Wave 3 "global chat" (docs/ghost-presence-design.md) — the slide-in panel.
 * Same `ModalPortal` shell convention as every other HUD modal (mandatory per-project
 * rule — iOS Safari's backdrop-filter containing-block trap). Mobile = bottom sheet
 * (half-height); desktop = a right-side column (~360px). Sending goes through
 * `chatSendSignal.ts` (the panel has no reference to the live `WorldSession` — see that
 * module's doc); receiving is pure store state (`chatMessages`, already capped/ingested
 * by `GameClient.tsx`), pruned to the 30-minute window HERE at render time
 * (`pruneToWindow`) on a 1s display tick so history visibly "ages out".
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { CHAT_TEXT_MAX, pruneToWindow } from "@/ui/chat/chatMessages";
import { requestSendChat } from "@/ui/chat/chatSendSignal";
import { useGameStore } from "@/ui/store/gameStore";

/** Client-local send-button cooldown UX (mirrors the server's real 1-msg/2s-per-conn
 *  rate limit, `scripts/party-relay/server.js`'s `chatRateMs`) — purely a "don't let the
 *  player mash the button" affordance; the server's `c-rej` (surfaced as a toast, see
 *  `GameClient.tsx`'s `onChat`) is the actual source of truth. */
const SEND_COOLDOWN_MS = 2_000;
/** How close to the bottom (px) counts as "already at the bottom" for auto-scroll —
 *  a reader scrolled up to read history shouldn't get yanked down by a new message. */
const STICK_TO_BOTTOM_PX = 40;

export interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const t = useTranslations("chat");
  const messages = useGameStore((s) => s.chatMessages);
  const [text, setText] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // 1Hz-ish display tick: drives BOTH the 30-min prune window and the cooldown countdown
  // — cheap (a plain re-render), never touches the store/engine.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const visible = pruneToWindow(messages, nowTick);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  function handleScroll(): void {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
  }

  const cooling = nowTick < cooldownUntil;
  const remainingSec = Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000));
  const canSend = text.trim().length > 0 && !cooling;

  function submit(): void {
    const trimmed = text.trim().slice(0, CHAT_TEXT_MAX);
    if (!trimmed || cooling) return;
    requestSendChat(trimmed);
    setText("");
    setCooldownUntil(Date.now() + SEND_COOLDOWN_MS);
    stickToBottomRef.current = true;
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-end justify-center sm:items-center sm:justify-end sm:p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
      >
        <button
          type="button"
          aria-label={t("closeButton")}
          onClick={onClose}
          className="absolute inset-0 bg-black/60"
        />
        <div className="animate-onboarding-in relative flex h-[55vh] w-full flex-col gap-2 rounded-t-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-3 text-ddp-ink shadow-(--ddp-shadow-panel) sm:h-[70vh] sm:w-[360px] sm:rounded-(--ddp-radius-lg)">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-ddp-gold-bright">{t("title")}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("closeButton")}
              className="rounded-md px-2 py-1 text-ddp-ink-muted hover:text-ddp-ink"
            >
              {"✕"}
            </button>
          </div>
          <p className="text-[10px] text-ddp-ink-muted">{t("hint")}</p>

          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-2"
          >
            {visible.length === 0 ? (
              <p className="text-[11px] text-ddp-ink-muted">{t("empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {visible.map((m) => (
                  <li key={m.id} className="text-[12px] leading-snug break-words">
                    <span className="font-bold text-sky-300">{m.name}</span>
                    <span className="text-ddp-ink-muted">{": "}</span>
                    <span className="text-ddp-ink">{m.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              maxLength={CHAT_TEXT_MAX}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={t("placeholder")}
              className="min-w-0 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-2 text-[12px] text-ddp-ink placeholder:text-ddp-ink-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="shrink-0 rounded-(--ddp-radius-md) border border-ddp-gold/50 bg-ddp-gold/15 px-3 py-2 text-[11px] font-bold text-ddp-gold-bright disabled:opacity-40"
            >
              {cooling ? `${remainingSec}s` : t("sendButton")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
