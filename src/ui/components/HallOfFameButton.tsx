"use client";

/**
 * M7.95 Hall of Fame — console-dock entry point (mirrors
 * `CodexButton.tsx`/`InventoryButton.tsx`: a purely local open/closed
 * `useState`, the sim keeps running behind the modal). The goal card's 🏆
 * rung (`GoalLadder.tsx`) opens the same `HallOfFamePanel` independently —
 * two entry points, each owning its own open state, same pattern every other
 * modal trigger in this HUD already follows.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { HallOfFamePanel } from "@/ui/hof/HallOfFamePanel";

export function HallOfFameButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("hof");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
      >
        {t("openButton")}
      </button>
      {open && <HallOfFamePanel onClose={() => setOpen(false)} />}
    </>
  );
}
