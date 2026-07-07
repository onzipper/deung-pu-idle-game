"use client";

/**
 * Settings-drawer trigger for the settings row (M6 settings-panel task) —
 * same local-`useState` open/close pattern as `CodexButton.tsx` (purely a UI
 * concern; the sim keeps running behind the drawer).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SettingsPanel } from "@/ui/components/SettingsPanel";
import { onOpenAccountSettingsRequest } from "@/ui/openSettingsSignal";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("settings");

  // Friends panel's guest-state CTA ("go to My Account") asks this drawer to
  // open itself — see `openSettingsSignal.ts`'s doc.
  useEffect(() => onOpenAccountSettingsRequest(() => setOpen(true)), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        {t("openButton")}
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
