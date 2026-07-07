"use client";

/**
 * Consolidated bot-settings modal (owner UX consolidation, 2026-07-07) — ONE
 * home for every automation sub-behavior, opened via the ⚙ button beside the
 * bot master switch (`BotMasterSwitch.tsx`). Replaces the scattered auto-*
 * controls that used to live in `SettingsPanel.tsx` (auto-allocate,
 * auto-return/advance, auto-potion, bot town-trip settings, auto-dispose
 * rules) plus the standalone "Auto สกิล" pill in `SkillBar.tsx` — per the
 * house UX rule "one mental model per feature, ONE settings modal" (see
 * `.claude/skills/game-ux/SKILL.md`).
 *
 * `SettingsPanel.tsx` now keeps only sound/language/generic prefs; ALL
 * automation config lives here, grouped exactly like the master switch's own
 * mental model: ⚔ combat, 🧪 potions, 🏠 town trips, 🎒 drops, 🚶 walking.
 *
 * Every control here dispatches through the SAME store actions the old
 * scattered components used (nothing new engine-side) — this modal is purely
 * a layout/consolidation change. The two ENGINE-PERSISTED bot sub-flags
 * (`bot.enabled`/`bot.sellTripEnabled`) are the one exception that needs
 * active disabling while the master is off (see `BotSettingsSection`'s
 * `masterOn` prop + `gameStore.ts`'s `toggleBotMaster` doc) — every other
 * toggle here is a plain per-frame-gated UI preference, safe to edit anytime.
 */

import { useTranslations } from "next-intl";
import { AutoAdvanceToggle, AutoReturnToggle } from "@/ui/components/AutoReturnToggle";
import { AutoPotionToggles } from "@/ui/components/AutoPotionToggles";
import { AutoSellRulesSection } from "@/ui/components/AutoSellRulesSection";
import { BotSettingsSection } from "@/ui/components/BotSettingsSection";
import { InfoTip } from "@/ui/components/InfoTip";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { useGameStore } from "@/ui/store/gameStore";

function AutoAllocateToggleRow() {
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const toggle = useGameStore((s) => s.toggleAutoAllocate);
  const t = useTranslations("stats");

  return (
    <button
      type="button"
      onClick={toggle}
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

function AutoCastToggleRow() {
  const autoCast = useGameStore((s) => s.autoCast);
  const toggle = useGameStore((s) => s.toggleAutoCast);
  const t = useTranslations("panels");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={autoCast}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
        autoCast
          ? "border-emerald-400 bg-emerald-400 text-emerald-950"
          : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${autoCast ? "bg-emerald-950" : "bg-ddp-ink-muted"}`}
      />
      {t("autoSkillToggle", { state: autoCast ? "on" : "off" })}
    </button>
  );
}

/** Read-only auto-cast SLOT overview: the assignment itself still happens via
 * the "+ อัตโนมัติ" badges under each skill in `SkillBar.tsx` (an owner-approved
 * shortcut — they mirror the same store state, see the task brief), but this
 * lets the player see/clear the whole loadout from the same consolidated
 * modal without hunting through the skill bar. */
function AutoSlotsOverview() {
  const hero = useGameStore((s) => s.heroes[0]);
  const setAutoSlot = useGameStore((s) => s.setAutoSlot);
  const t = useTranslations("settings.bot");
  const tContent = useTranslations("content");

  if (!hero) return null;
  const slots = hero.autoSlots.slice(0, hero.unlockedSlots);
  if (slots.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-ddp-ink-muted/80">{t("autoSlotsTitle")}</span>
      <div className="flex flex-wrap gap-1.5">
        {slots.map((skillId, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 py-1 text-[11px] font-semibold text-ddp-ink"
          >
            {skillId ? tContent(`skills.${skillId}.name`) : t("autoSlotEmpty")}
            {skillId && (
              <button
                type="button"
                onClick={() => setAutoSlot(i, null)}
                aria-label={t("autoSlotClearAria", {
                  skill: tContent(`skills.${skillId}.name`),
                })}
                className="text-ddp-ink-muted hover:text-ddp-ink"
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function GroupHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
      {label}
      <InfoTip text={hint} ariaLabel={hint} />
    </h3>
  );
}

export interface BotSettingsModalProps {
  onClose: () => void;
}

export function BotSettingsModal({ onClose }: BotSettingsModalProps) {
  const botMasterOn = useGameStore((s) => s.autoHunt);
  const t = useTranslations("settings.botModal");
  const tHud = useTranslations("hud");

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

          <p className="text-[11px] text-ddp-ink-muted/80">{tHud("botMasterHint")}</p>

          {!botMasterOn && (
            <p className="rounded-(--ddp-radius-md) border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
              {t("masterOffHint")}
            </p>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <section className="flex flex-col gap-2.5">
              <GroupHeader label={t("combatGroup")} hint={t("combatGroupHint")} />
              <div className="flex flex-wrap gap-2">
                <AutoCastToggleRow />
                <AutoAllocateToggleRow />
              </div>
              <AutoSlotsOverview />
            </section>

            <div className="h-px bg-ddp-border-soft" />

            <section className="flex flex-col gap-2.5">
              <GroupHeader label={t("potionGroup")} hint={t("potionGroupHint")} />
              <AutoPotionToggles />
            </section>

            <div className="h-px bg-ddp-border-soft" />

            <section className="flex flex-col gap-2.5">
              <GroupHeader label={t("townGroup")} hint={t("townGroupHint")} />
              <BotSettingsSection masterOn={botMasterOn} />
            </section>

            <div className="h-px bg-ddp-border-soft" />

            <section className="flex flex-col gap-2.5">
              <GroupHeader label={t("dropGroup")} hint={t("dropGroupHint")} />
              <AutoSellRulesSection />
            </section>

            <div className="h-px bg-ddp-border-soft" />

            <section className="flex flex-col gap-2.5">
              <GroupHeader label={t("walkGroup")} hint={t("walkGroupHint")} />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <AutoReturnToggle />
                  <InfoTip text={t("autoReturnHint")} />
                </div>
                <div className="flex items-center gap-1.5">
                  <AutoAdvanceToggle />
                  <InfoTip text={t("autoAdvanceHint")} />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
