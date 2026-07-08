"use client";

/**
 * Settings drawer (M6 settings-panel task, ROADMAP.md line 29) — generic
 * client preferences ONLY: sound + language. Every automation sub-behavior
 * (auto-allocate, death/advance behavior, auto-potion, bot town-trip
 * settings, auto-dispose rules) moved OUT of here into the consolidated
 * `BotSettingsModal.tsx` (owner UX consolidation, 2026-07-07 — "one mental
 * model per feature": ONE bot switch + ONE bot-settings modal, opened from
 * the `BotMasterSwitch` beside the walk controls, not from this drawer).
 * Same modal shell/z-layer convention as `CodexPanel.tsx` (the sim never
 * pauses behind it — idle game rule).
 */

import { useTranslations } from "next-intl";
import { LocaleSwitch } from "@/ui/components/LocaleSwitch";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { SoundToggle } from "@/ui/components/SoundToggle";
import { GhostToggle } from "@/ui/components/GhostToggle";
import { AccountSection } from "@/ui/components/settings/AccountSection";
import { TitleSection } from "@/ui/components/settings/TitleSection";

export interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const t = useTranslations("settings");

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <button
        type="button"
        aria-label={t("closeButton")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
          >
            ✕ {t("closeButton")}
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
              {t("audioLanguageGroup")}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <SoundToggle />
              <LocaleSwitch />
            </div>
            <GhostToggle />
          </section>

          <TitleSection />

          <AccountSection />
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
