"use client";

/**
 * M7.6 ตีบวก — refine-station trigger for the settings row. Same local
 * `useState` open/close pattern as `InventoryButton.tsx`/`CodexButton.tsx`: a
 * purely UI concern, the sim keeps running behind the modal. Unlike
 * `ShopPanel.tsx` (only rendered while standing in town), this button is
 * ALWAYS visible — `RefinePanel.tsx` itself explains "town-only" with a
 * disabled reason once opened (per spec: browsing/picking an item to refine
 * is fine from anywhere, only the actual attempt is gated).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { RefinePanel } from "@/ui/components/RefinePanel";

export function RefineButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("refine");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        <span aria-hidden>⚒</span> {t("openButton")}
      </button>
      {open && <RefinePanel onClose={() => setOpen(false)} />}
    </>
  );
}
