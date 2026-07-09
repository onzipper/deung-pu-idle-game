"use client";

/**
 * Per-hero skill KIT (M5 "mana + skill framework v2"): a mana bar plus a button
 * per LEARNED skill (cost + cooldown sweep, disabled when unaffordable / on
 * cooldown / dead), a tap-to-open ⓘ detail popover per skill (desc + live
 * numbers), and a simple auto-slot assignment (tap a skill's AUTO badge to
 * toggle it into a free unlocked auto-cast slot). The level badge and HP/XP
 * bars carry over from the pre-v2 bar. The class-change QUEST affordance
 * (accept/progress/change-class) that used to live here moved entirely into
 * `GoalLadder.tsx`'s `ClassQuestCard` (UX-fix wave, audit #1 — "quest actions
 * in one place").
 *
 * The cooldown sweep is pure CSS: a linear `height` animation whose duration is
 * the skill's max cooldown and whose `animation-delay` is negative by the
 * ALREADY-elapsed amount, so it visually resumes at the right point from a single
 * throttled snapshot value. It only restarts (remounts via `key`) on a fresh cast.
 *
 * R2-W4: the old per-skill ⓘ `InfoTip` (a small text popover) now opens the
 * full `SkillDetailModal` list+detail pane instead (`docs/ui-reference-map.md`'s
 * SKILL UI row) — the modal instance is lifted to `HeroSkills` (one mount for
 * the whole kit, not one per button) and `SkillButton` just reports which
 * skill id to open via `onOpenDetail`.
 *
 * R2-W2 "fullscreen HUD": the mockup-style portrait block (class roundel +
 * Lv/name + HP/MP/EXP bars + power) that used to sit ABOVE the skill kit here
 * moved OUT into its own top-left overlay card (`HeroPortraitCard.tsx`,
 * verbatim extraction, zero behavior change) — this file now renders ONLY the
 * skill kit + bot switch, for the bottom-center skill dock.
 */

import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import { CONFIG } from "@/engine";
import { useCastKey } from "@/ui/hooks/useCastKey";
import { BotMasterSwitch } from "@/ui/components/BotMasterSwitch";
import { SkillDetailModal } from "@/ui/components/SkillDetailModal";
import type { HeroSummary, SkillSummary } from "@/ui/store/gameStore";
import { HERO_ACCENT, SKILL_ICONS_BY_ID } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";


/** One learned skill: a cast button + an AUTO-slot toggle badge + a tap-to-open
 * detail trigger (owner ask, UX-fix wave: "every skill button gets a
 * tap-to-open detail" — R2-W4 evolved this from a small `InfoTip` text
 * popover into the full `SkillDetailModal` list+detail pane, see that file's
 * doc). The class-change quest's accept/change-class controls used to live in
 * this file's `ClassQuestAffordance` — that's gone; the WHOLE quest flow now
 * lives in `GoalLadder.tsx`'s `ClassQuestCard` (audit #1). */
function SkillButton({
  hero,
  skill,
  slotNumber,
  onOpenDetail,
}: {
  hero: HeroSummary;
  skill: SkillSummary;
  /** 1-based display position in the hero's learned-skill row (mockup's
   * numbered hotbar slots, R2-W2) — purely a display ordinal, NOT the
   * auto-cast slot index (`skill.autoSlot`, shown by the badge below). */
  slotNumber: number;
  /** Opens `SkillDetailModal` on this skill (lifted to `HeroSkills` so the
   * whole kit shares ONE modal instance instead of one per button). */
  onOpenDetail: (skillId: string) => void;
}) {
  const castSkill = useGameStore((s) => s.castSkill);
  const setAutoSlot = useGameStore((s) => s.setAutoSlot);
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");
  const skillName = tContent(`skills.${skill.id}.name`);
  const icon = SKILL_ICONS_BY_ID[skill.id] ?? "✦";
  const accent = HERO_ACCENT[hero.cls];
  const castKey = useCastKey(skill.cd);

  const ready = skill.ready;
  const delay = -(skill.maxCd - skill.cd);
  const cdSeconds = Math.ceil(skill.cd);
  const status = hero.dead
    ? "dead"
    : ready
      ? "none"
      : skill.cd > 0
        ? "cooldown"
        : "nomana";

  const inSlot = skill.autoSlot !== null;
  const firstFreeSlot = hero.autoSlots.findIndex(
    (id, i) => i < hero.unlockedSlots && id === null,
  );
  const canToggleAuto = inSlot || firstFreeSlot >= 0;

  function toggleAuto(): void {
    if (inSlot) setAutoSlot(skill.autoSlot!, null);
    else if (firstFreeSlot >= 0) setAutoSlot(firstFreeSlot, skill.id);
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative">
        <button
          type="button"
          disabled={!ready}
          onClick={() => castSkill(skill.id)}
          aria-label={tPanels("skillAriaLabel", {
            heroName: skillName,
            skillName,
            status,
            seconds: cdSeconds,
          })}
          style={
            { "--accent": accent.solid, "--accent-soft": accent.soft } as CSSProperties
          }
          className={`relative h-20 w-20 rounded-(--ddp-radius-md) border shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.96] ${
            ready
              ? "border-(--accent-soft) before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_18px_3px_var(--accent-soft)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.4s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110"
              : "border-ddp-border disabled:cursor-not-allowed"
          }`}
        >
          <span
            className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[inherit] bg-ddp-panel-strong ${
              !ready ? "grayscale" : ""
            }`}
          >
            <span className="text-2xl leading-none">{icon}</span>
            <span className="mt-1 line-clamp-1 px-0.5 text-[10px] leading-tight text-ddp-ink-muted">
              {skillName}
            </span>
            <span
              className={`text-[11px] leading-none font-semibold tabular-nums ${
                skill.affordable ? "text-sky-300" : "text-red-400"
              }`}
            >
              {tPanels("skillManaCost", { cost: skill.cost })}
            </span>
            {skill.cd > 0 && !hero.dead && (
              <span
                key={castKey}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 [animation-name:ddp-cooldown-sweep] [animation-timing-function:linear] [animation-fill-mode:forwards]"
                style={{
                  animationDuration: `${skill.maxCd}s`,
                  animationDelay: `${delay}s`,
                }}
              />
            )}
            {skill.cd > 0 && !hero.dead && (
              <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-ddp-ink tabular-nums">
                {cdSeconds}
              </span>
            )}
            {hero.dead && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs font-bold text-red-400">
                {tPanels("heroDeadBadge")}
              </span>
            )}
          </span>
        </button>
        {/* Owner ask (UX-fix wave): every skill button gets a tap-to-open
            detail — R2-W4 opens the full `SkillDetailModal` list+detail pane
            instead of a small text popover. Sits OUTSIDE the cast `<button>`
            (siblings, not nested — nested buttons are invalid HTML) at its
            top-left corner, same ≥44px hit-zone trick `InfoTip` used. */}
        <button
          type="button"
          onClick={() => onOpenDetail(skill.id)}
          aria-label={tPanels("skillInfoAria", { skillName })}
          className="absolute -top-1.5 -left-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border border-ddp-border-soft bg-black/30 text-[10px] leading-none font-bold text-ddp-ink-muted before:absolute before:-inset-3 before:content-[''] hover:text-ddp-ink active:scale-90"
        >
          <span aria-hidden>ⓘ</span>
        </button>
        {/* Numbered hotbar badge (mockup "1-5 กำกับ") — pure display ordinal,
            opposite corner from the ⓘ detail tip so the two never collide. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-ddp-border-soft bg-black/85 text-[10px] font-black tabular-nums text-ddp-ink-muted"
        >
          {slotNumber}
        </span>
      </div>
      <button
        type="button"
        onClick={toggleAuto}
        disabled={!canToggleAuto}
        aria-pressed={inSlot}
        title={tPanels("autoSlotToggleHint")}
        className={`min-h-7 w-20 rounded-full border px-1 py-1 text-[10px] font-bold transition-colors ${
          inSlot
            ? "border-emerald-400 bg-emerald-400/20 text-emerald-300"
            : canToggleAuto
              ? "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted hover:brightness-110"
              : "cursor-not-allowed border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted/50"
        }`}
      >
        {inSlot
          ? tPanels("autoSlotAssigned", { slot: (skill.autoSlot ?? 0) + 1 })
          : tPanels("autoSlotAdd")}
      </button>
    </div>
  );
}

/**
 * A hero's skill kit (R2-W2: the portrait block that used to sit above this
 * moved OUT into `HeroPortraitCard.tsx` — see this file's doc). Same
 * throttled snapshot fields, no new store reads.
 */
function HeroSkills({ hero }: { hero: HeroSummary }) {
  const tPanels = useTranslations("panels");
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);

  // Next locked auto-slot's unlock level (for the "more slots at Lv.X" hint).
  // The 4th slot (M7.9) is gated behind BOTH tier 3 AND Lv.40
  // (`CONFIG.autoSlots.tierRequired`) — when that's the next locked slot, swap
  // in a tier-aware hint copy so a sub-tier-3 hero past Lv.40 doesn't read a
  // stale "unlocks at Lv.40" (it also needs the tier-3 class change).
  const nextSlotIdx = hero.unlockedSlots;
  const nextLockedLevel =
    nextSlotIdx < CONFIG.autoSlots.max
      ? CONFIG.autoSlots.unlockLevels[nextSlotIdx]
      : null;
  const nextSlotNeedsHigherTier =
    nextSlotIdx < CONFIG.autoSlots.max &&
    CONFIG.autoSlots.tierRequired[nextSlotIdx] > hero.tier;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* War Cry's ATK-buff chip moved into the consolidated Buff Badge Hub
          (owner ask — every buff in ONE HUD spot, see BuffBadgeHub.tsx). */}

      {/* The learned skill kit */}
      <div className="flex flex-wrap items-start justify-center gap-2">
        {hero.skills.map((skill, i) => (
          <SkillButton
            key={skill.id}
            hero={hero}
            skill={skill}
            slotNumber={i + 1}
            onOpenDetail={setDetailSkillId}
          />
        ))}
      </div>
      {nextLockedLevel !== null && (
        <span className="text-[10px] text-ddp-ink-muted/70">
          {nextSlotNeedsHigherTier
            ? tPanels("autoSlotNextUnlockTier3", { level: nextLockedLevel })
            : tPanels("autoSlotNextUnlock", { level: nextLockedLevel })}
        </span>
      )}
      {/* ONE `SkillDetailModal` instance for the whole kit (R2-W4) — every
          `SkillButton`'s ⓘ trigger just sets which skill id to show. */}
      {detailSkillId && (
        <SkillDetailModal
          hero={hero}
          initialId={detailSkillId}
          onClose={() => setDetailSkillId(null)}
        />
      )}
    </div>
  );
}

export function SkillBar() {
  // MY hero only — the snapshot contract is "heroes[0] = my hero" (GameClient
  // reorders in cohort mode). Rendering every hero here showed the FRIEND's
  // whole skill kit + mana bar in an active party cohort, and those buttons'
  // castSkill intents target my own hero anyway (M8 live-test report).
  const hero = useGameStore((s) => s.heroes[0]);
  const t = useTranslations("panels");

  return (
    <div data-onboarding-anchor="skill-bar" className="flex flex-col gap-3">
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("skillsLabel")}
      </span>
      {hero && <HeroSkills hero={hero} />}
      {/* The "Auto สกิล" per-skill master toggle modal stays in
          `BotSettingsModal.tsx` (owner UX pass, 2026-07-07) — this bar keeps
          the per-skill "+ อัตโนมัติ" slot badges (mirrors the same store
          state, unchanged). The bot MASTER pill (`BotMasterSwitch`) is now
          mounted HERE instead of `WalkControls.tsx` (R2-W2 mockup: the
          action-bar row reads skills + AUTO together, "1-5 + AUTO"). It's a
          MOVE, not a duplicate — WalkControls no longer renders it, same
          single `state.autoHunt` control, same `BotSettingsModal` behind it,
          just restyled as the prominent pill the OFF-by-default bot now needs
          (see that file's own doc for the "inviting, not alarming" restyle). */}
      <div className="flex justify-center">
        <BotMasterSwitch />
      </div>
    </div>
  );
}
