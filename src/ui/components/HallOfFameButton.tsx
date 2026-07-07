"use client";

/**
 * M7.95 Hall of Fame — console-dock entry point (mirrors
 * `CodexButton.tsx`/`InventoryButton.tsx`: a purely local open/closed
 * `useState`, the sim keeps running behind the modal). The goal card's 🏆
 * rung (`GoalLadder.tsx`) opens the same `HallOfFamePanel` independently —
 * two entry points, each owning its own open state, same pattern every other
 * modal trigger in this HUD already follows. Gold-accent styling (audit
 * #2/#8, owner-reported "สีเหมือนกดไม่ได้" on the ladder's rung): both
 * entrances into this panel share the SAME visual language now, so neither
 * reads as a disabled/locked control.
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
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-gold/50 bg-ddp-gold/10 px-3 text-xs font-bold text-ddp-gold-bright shadow-(--ddp-shadow-btn) transition-all duration-100 hover:border-ddp-gold hover:bg-ddp-gold/20 active:translate-y-0.5 active:scale-[0.95]"
      >
        {t("openButton")}
      </button>
      {open && <HallOfFamePanel onClose={() => setOpen(false)} />}
    </>
  );
}
