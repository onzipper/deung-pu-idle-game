"use client";

/**
 * "ตำราตำนาน" — the NEW, SEPARATE main-menu entry (endgame v1.2/v1.3 owner
 * spec: "เมนูคราฟแยกเดี่ยว"). Visible ONLY once `tomeUnlocked` (the secret
 * 3-page quest is complete) — invisible (not just disabled) before that, so
 * the menu itself never spoils the quest's existence. Same local
 * open/close `useState` idiom as every other dock trigger
 * (`HallOfFameButton.tsx`/`CodexButton.tsx`), gold-violet accent to read as
 * distinctly legendary rather than an ordinary HUD button.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { AsuraTomePanel } from "@/ui/asura/AsuraTomePanel";
import { useGameStore } from "@/ui/store/gameStore";

export function AsuraTomeButton() {
  const [open, setOpen] = useState(false);
  const tomeUnlocked = useGameStore((s) => s.tomeUnlocked);
  const t = useTranslations("asura.tome");

  if (!tomeUnlocked) return null;

  return (
    <>
      <IconTileButton
        icon={<span aria-hidden>⚒️</span>}
        accent="fuchsia"
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
      />
      {open && <AsuraTomePanel onClose={() => setOpen(false)} />}
    </>
  );
}
