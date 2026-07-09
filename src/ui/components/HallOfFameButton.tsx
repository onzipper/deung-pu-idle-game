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
import { BossIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { HallOfFamePanel } from "@/ui/hof/HallOfFamePanel";

export function HallOfFameButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("hof");

  return (
    <>
      <IconTileButton
        icon={<BossIcon className="h-5 w-5" />}
        accent="gold"
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
      />
      {open && <HallOfFamePanel onClose={() => setOpen(false)} />}
    </>
  );
}
