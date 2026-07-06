"use client";

/**
 * Settings drawer (M6 settings-panel task, ROADMAP.md line 29) — groups the
 * previously-scattered UI-owned toggles into one place: auto-allocate stat
 * points, death behavior (auto-return), auto-potion use + thresholds, sound,
 * and language. Same modal shell/z-layer convention as `CodexPanel.tsx` (the
 * sim never pauses behind it — idle game rule).
 *
 * `autoCast`'s per-skill auto-slot assignment stays in `SkillBar.tsx` — it's
 * genuinely part of the skill block (which skill goes in which slot), not a
 * generic on/off preference like the toggles gathered here.
 */

import { useTranslations } from "next-intl";
import { AutoPotionToggles } from "@/ui/components/AutoPotionToggles";
import { AutoReturnToggle } from "@/ui/components/AutoReturnToggle";
import { LocaleSwitch } from "@/ui/components/LocaleSwitch";
import { SoundToggle } from "@/ui/components/SoundToggle";
import { useGameStore } from "@/ui/store/gameStore";

function AutoAllocateRow() {
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const toggleAutoAllocate = useGameStore((s) => s.toggleAutoAllocate);
  const t = useTranslations("stats");

  return (
    <button
      type="button"
      onClick={toggleAutoAllocate}
      aria-pressed={autoAllocate}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
        autoAllocate
          ? "border-emerald-400 bg-emerald-400 text-emerald-950"
          : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${autoAllocate ? "bg-emerald-950" : "bg-ddp-ink-muted"}`}
      />
      {t("autoAllocateToggle", { state: autoAllocate ? "on" : "off" })}
    </button>
  );
}

export interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const t = useTranslations("settings");

  return (
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
          <section className="flex flex-col gap-2.5">
            <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
              {t("autoBehaviorGroup")}
            </h3>
            <AutoAllocateRow />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-ddp-ink-muted/80">
                {t("deathBehaviorLabel")}
              </span>
              <AutoReturnToggle />
            </div>
            <AutoPotionToggles />
          </section>

          <div className="h-px bg-ddp-border-soft" />

          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
              {t("audioLanguageGroup")}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <SoundToggle />
              <LocaleSwitch />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
