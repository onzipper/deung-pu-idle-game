"use client";

/**
 * Small "คู่มือ" (guide/codex) trigger for the settings row. Owns the
 * open/closed state locally (purely a UI concern, never gameplay/save
 * state) and mounts `CodexPanel` as a modal on top of the canvas when open
 * — the sim keeps running behind it (idle game rule: never pause on a menu).
 *
 * No unread/discovery nudge by design (task M4.8 scope: that's the
 * contextual-tutorial card's job) — this button stays quiet and always
 * visible.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CodexPanel } from "@/ui/codex/CodexPanel";

export function CodexButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("codex");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        {t("openButton")}
      </button>
      {open && <CodexPanel onClose={() => setOpen(false)} />}
    </>
  );
}
