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
import { QuestIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { CodexPanel } from "@/ui/codex/CodexPanel";

export function CodexButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("codex");

  return (
    <>
      <IconTileButton
        icon={<QuestIcon className="h-5 w-5" />}
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
      />
      {open && <CodexPanel onClose={() => setOpen(false)} />}
    </>
  );
}
