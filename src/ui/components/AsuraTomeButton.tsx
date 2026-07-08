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
import { AsuraTomePanel } from "@/ui/asura/AsuraTomePanel";
import { useGameStore } from "@/ui/store/gameStore";

export function AsuraTomeButton() {
  const [open, setOpen] = useState(false);
  const tomeUnlocked = useGameStore((s) => s.tomeUnlocked);
  const t = useTranslations("asura.tome");

  if (!tomeUnlocked) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-fuchsia-400/50 bg-fuchsia-400/10 px-3 text-xs font-bold text-fuchsia-200 shadow-(--ddp-shadow-btn) transition-all duration-100 hover:border-fuchsia-400 hover:bg-fuchsia-400/20 active:translate-y-0.5 active:scale-[0.95]"
      >
        <span aria-hidden>⚒️</span> {t("openButton")}
      </button>
      {open && <AsuraTomePanel onClose={() => setOpen(false)} />}
    </>
  );
}
