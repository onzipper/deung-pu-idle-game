"use client";

/**
 * M7 Gear & Drops — inventory/equip trigger for the settings row. Same local
 * `useState` open/close pattern as `CodexButton.tsx`/`SettingsButton.tsx`: a
 * purely UI concern, the sim keeps running behind the modal (idle game rule).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { InventoryPanel } from "@/ui/components/InventoryPanel";

export function InventoryButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("inventory");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        {t("openButton")}
      </button>
      {open && <InventoryPanel onClose={() => setOpen(false)} />}
    </>
  );
}
