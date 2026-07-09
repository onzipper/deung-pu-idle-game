"use client";

/**
 * R2-W2 "fullscreen HUD" — the NEW "ตัวละคร" (character) panel: houses
 * `StatPanel` (base-stat +buttons) + `EquippedLoadout` (weapon/armor summary)
 * + `SwitchCharacterLink` (roster navigation), all three moved OUT of the old
 * in-flow console dock's bottom "settings row" (`GameHud.tsx` pre-rewrite) —
 * see `CharacterButton.tsx` for the icon-tile trigger. Same modal
 * shell/z-layer convention as `SettingsPanel.tsx` (the sim never pauses
 * behind it — idle game rule).
 */

import { useTranslations } from "next-intl";
import { EquippedLoadout } from "@/ui/components/EquippedLoadout";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { StatPanel } from "@/ui/components/StatPanel";
import { SwitchCharacterLink } from "@/ui/components/SwitchCharacterLink";

export interface CharacterPanelProps {
  onClose: () => void;
}

export function CharacterPanel({ onClose }: CharacterPanelProps) {
  const t = useTranslations("hud");

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("characterPanelTitle")}
      >
        <button
          type="button"
          aria-label={t("characterPanelCloseAria")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-ddp-gold-bright">
              {t("characterPanelTitle")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-3.5">
            <StatPanel />
            <div className="h-px bg-ddp-border-soft" />
            <EquippedLoadout />
            <div className="h-px bg-ddp-border-soft" />
            <SwitchCharacterLink />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
