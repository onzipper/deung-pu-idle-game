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
 *
 * R2-W4 "promote to a dedicated บอท panel" (`docs/ui-reference-map.md`'s BOT
 * UI row): visual/layout pass only — same single entry point (the ⚙ beside
 * `BotMasterSwitch` in `SkillBar.tsx`, unchanged, "one mental model per
 * feature"), same modal, same store wiring. Regrouped into the 3 clusters the
 * mockup names (สกิลอัตโนมัติ / ตั้งค่าอัตโนมัติ / การเดิน · พื้นที่) via a
 * boxed-`<section>` reskin using the R1/R2 token system; the old
 * potion/town/drop sub-labels are kept as smaller inline captions nested
 * inside the merged "ตั้งค่าอัตโนมัติ" box (`BotSettingsSection`/
 * `AutoSellRulesSection` already self-header, so only `AutoPotionToggles`
 * needed a caption added). The read-only auto-slot OVERVIEW (chips + ✕) is
 * replaced by `SkillAutoSlotPicker` — a tap-to-toggle ICON grid per the
 * mockup's "สกิลออโต้ติ๊กเลือก" ask, wired through the exact same
 * `setAutoSlot` action `SkillBar.tsx`'s per-skill badge already uses (no new
 * store/engine surface). No save button was added — every control here
 * already applies instantly (see the module doc above); a small caption
 * communicates that instead of a fake "บันทึก" affordance.
 */

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { AutoAdvanceToggle, AutoReturnToggle } from "@/ui/components/AutoReturnToggle";
import { AutoPotionToggles } from "@/ui/components/AutoPotionToggles";
import { AutoSellRulesSection } from "@/ui/components/AutoSellRulesSection";
import { BotSettingsSection } from "@/ui/components/BotSettingsSection";
import { InfoTip } from "@/ui/components/InfoTip";
import { SkillIcon } from "@/ui/components/icons/gameIcons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { HERO_ACCENT, SKILL_ICONS_BY_ID } from "@/ui/labels";
import { useGameStore, type HeroSummary, type SkillSummary } from "@/ui/store/gameStore";

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

/** One tappable icon TILE in the auto-cast slot picker (issue #58 item 1,
 * #54 audit reskin) — visually matches `SkillBar.tsx`'s `SkillButton` tile
 * language (icon + name centered, a numbered ordinal badge in the same
 * top-right corner spot as its "numbered hotbar slots"), just smaller since
 * this lives in a settings panel. Checked/ringed = currently occupying an
 * auto-cast slot. Tapping toggles it into the first free unlocked slot (or
 * clears its current one) — the EXACT toggle logic `SkillButton` already
 * uses against the same `setAutoSlot` action; this is a second entry point
 * into the same state, not a new capability. */
function SkillAutoSlotItem({
  hero,
  skill,
  slotNumber,
  t,
  tContent,
}: {
  hero: HeroSummary;
  skill: SkillSummary;
  /** 1-based display ordinal within the hero's learned-skill row — same
   * "numbered hotbar slot" concept `SkillBar.tsx`'s `slotNumber` prop carries,
   * NOT the auto-cast slot index (`skill.autoSlot`, shown via the ring/✓
   * badge instead). */
  slotNumber: number;
  t: ReturnType<typeof useTranslations>;
  tContent: ReturnType<typeof useTranslations>;
}) {
  const setAutoSlot = useGameStore((s) => s.setAutoSlot);
  const inSlot = skill.autoSlot !== null;
  const firstFreeSlot = hero.autoSlots.findIndex(
    (id, i) => i < hero.unlockedSlots && id === null,
  );
  const canToggle = inSlot || firstFreeSlot >= 0;
  const accent = HERO_ACCENT[hero.cls];
  const icon = SKILL_ICONS_BY_ID[skill.id] ?? "✦";
  const name = tContent(`skills.${skill.id}.name`);

  function toggle(): void {
    if (inSlot) setAutoSlot(skill.autoSlot!, null);
    else if (firstFreeSlot >= 0) setAutoSlot(firstFreeSlot, skill.id);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!canToggle}
      aria-pressed={inSlot}
      title={canToggle ? undefined : t("autoSlotPickerFull")}
      aria-label={t("autoSlotPickerAria", { skill: name })}
      style={{ "--accent": accent.solid, "--accent-soft": accent.soft } as CSSProperties}
      className={`relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border bg-ddp-panel-strong px-1 py-1 shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.96] ${
        inSlot
          ? "border-emerald-400 shadow-[0_0_10px_1px_rgba(52,211,153,0.5)]"
          : canToggle
            ? "border-ddp-border-soft hover:border-(--accent-soft)"
            : "cursor-not-allowed border-ddp-border-soft/40 opacity-40 grayscale"
      }`}
    >
      <span aria-hidden className="text-xl leading-none">
        <SkillIcon skillId={skill.id} fallback={icon} className="h-5 w-5" />
      </span>
      <span className="line-clamp-1 w-full px-0.5 text-center text-[9px] leading-tight text-ddp-ink-muted">
        {name}
      </span>
      {/* Numbered ordinal badge — top-right corner, same spot/style
          `SkillBar.tsx`'s numbered hotbar badge uses. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-ddp-border-soft bg-black/85 text-[9px] leading-none font-black tabular-nums text-ddp-ink-muted"
      >
        {slotNumber}
      </span>
      {/* Auto-enabled ✓ badge — top-left corner, only while slotted (the
          emerald ring already signals it; this badge makes it unmissable at
          a glance, matching the old checklist's ✓ column). */}
      {inSlot && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-emerald-400 bg-emerald-400 text-[9px] leading-none font-black text-emerald-950"
        >
          ✓
        </span>
      )}
    </button>
  );
}

/** The full picker: every LEARNED skill (current tier chain, same set
 * `SkillBar.tsx` renders) as a checkable icon TILE in a single compact row
 * (wraps on narrow screens) — reskin per the #54 audit ("match the on-screen
 * SkillDock"), same underlying `setAutoSlot` state as before, presentation
 * only. */
function SkillAutoSlotPicker() {
  const hero = useGameStore((s) => s.heroes[0]);
  const t = useTranslations("settings.bot");
  const tContent = useTranslations("content");

  if (!hero || hero.skills.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-ddp-ink-muted/80">{t("autoSlotsTitle")}</span>
      <div className="flex flex-wrap justify-center gap-2">
        {hero.skills.map((skill, i) => (
          <SkillAutoSlotItem
            key={skill.id}
            hero={hero}
            skill={skill}
            slotNumber={i + 1}
            t={t}
            tContent={tContent}
          />
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
        <Panel
          variant="gold"
          className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-hidden"
        >
          <PanelHeader
            title={t("title")}
            icon={<span aria-hidden>🤖</span>}
            actions={
              <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
                ✕ {t("closeButton")}
              </Button>
            }
          />

          <p className="text-[11px] text-ddp-ink-muted/80">{tHud("botMasterHint")}</p>

          {!botMasterOn && (
            <p className="rounded-(--ddp-radius-md) border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
              {t("masterOffHint")}
            </p>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {/* สกิลอัตโนมัติ — the master on/off + the tick-select icon grid. */}
            <section className="flex flex-col gap-2.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/15 p-3">
              <GroupHeader label={t("skillGroup")} hint={t("skillGroupHint")} />
              <AutoCastToggleRow />
              <SkillAutoSlotPicker />
            </section>

            {/* ตั้งค่าอัตโนมัติ — potion thresholds + town restock/sell-trip/
                auto-equip + drop rules + auto-stat, merged into one box (each
                sub-cluster keeps its own smaller caption/self-header). */}
            <section className="flex flex-col gap-3 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/15 p-3">
              <GroupHeader label={t("generalGroup")} hint={t("generalGroupHint")} />
              <AutoAllocateToggleRow />

              <div className="h-px bg-ddp-border-soft/60" />
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted/70 uppercase">
                  {t("potionGroup")}
                </span>
                <AutoPotionToggles />
              </div>

              <div className="h-px bg-ddp-border-soft/60" />
              <BotSettingsSection masterOn={botMasterOn} />

              <div className="h-px bg-ddp-border-soft/60" />
              <AutoSellRulesSection />
            </section>

            {/* การเดิน / พื้นที่ */}
            <section className="flex flex-col gap-2.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/15 p-3">
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

          {/* บันทึก — every control above applies instantly (see the module
              doc); this is a status caption, not a save action. */}
          <p className="shrink-0 text-center text-[10px] text-ddp-ink-muted/60">
            ✓ {t("instantApplyNote")}
          </p>
        </Panel>
      </div>
    </ModalPortal>
  );
}
