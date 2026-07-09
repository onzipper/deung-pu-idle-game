"use client";

/**
 * M7 Gear & Drops — inventory/equip trigger for the top-right icon menu row.
 * Same local `useState` open/close pattern as `CodexButton.tsx`/
 * `SettingsButton.tsx`: a purely UI concern, the sim keeps running behind the
 * modal (idle game rule). R2-W2 "fullscreen HUD": icon-only tile (was a
 * labeled pill) via `IconTileButton` — the visible label moved to
 * `aria-label`/`title`.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BagIcon } from "@/ui/components/icons";
import { InventoryPanel } from "@/ui/components/InventoryPanel";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";

export function InventoryButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("inventory");

  return (
    <>
      <IconTileButton
        icon={<BagIcon className="h-5 w-5" />}
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
      />
      {open && <InventoryPanel onClose={() => setOpen(false)} />}
    </>
  );
}
