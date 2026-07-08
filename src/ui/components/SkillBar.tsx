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
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HeroClass } from "@/engine";
import { CONFIG, SKILLS } from "@/engine";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { InfoTip } from "@/ui/components/InfoTip";
import type { HeroSummary, SkillSummary } from "@/ui/store/gameStore";
import { SKILL_ICONS_BY_ID } from "@/ui/labels";
import { skillStatParts } from "@/ui/skillStats";
import { useGameStore } from "@/ui/store/gameStore";

/** The `content.classes.<cls>.<key>` i18n key for hero.tier's display name:
 * tier 1 = base name, tier 2 = `evolvedName`, tier 3 = `tier3Name` (M7.9
 * grand-expansion final form). */
function classNameKeyForTier(tier: 1 | 2 | 3): "name" | "evolvedName" | "tier3Name" {
  if (tier === 2) return "evolvedName";
  if (tier === 3) return "tier3Name";
  return "name";
}

/** Presentational-only per-class accent (mirrors src/render/theme.ts
 * HERO_COLORS). `soft` is a pre-mixed rgba so button classes never need a
 * Tailwind opacity-modifier on an arbitrary CSS-var color. */
const HERO_ACCENT: Record<HeroClass, { solid: string; soft: string }> = {
  swordsman: { solid: "#35d0c0", soft: "rgba(53, 208, 192, 0.55)" },
  archer: { solid: "#b8e04a", soft: "rgba(184, 224, 74, 0.55)" },
  mage: { solid: "#c77dff", soft: "rgba(199, 125, 255, 0.55)" },
  // matches `HERO_COLORS.ninja.body` in render/theme.ts (slate/graphite rig tone)
  ninja: { solid: "#6c7a99", soft: "rgba(108, 122, 153, 0.55)" },
};

/** Detects a fresh cast (cd jumped back up) to restart the CSS sweep. */
function useCastKey(cd: number): number {
  const prev = useRef(cd);
  const [castKey, setCastKey] = useState(0);
  useEffect(() => {
    if (cd > prev.current + 0.05) setCastKey((k) => k + 1);
    prev.current = cd;
  }, [cd]);
  return castKey;
}

/** One learned skill: a cast button + an AUTO-slot toggle badge + a tap-to-open
 * ⓘ detail popover (owner ask, UX-fix wave: "every skill button gets a
 * tap-to-open detail" — desc line + live numbers from `CONFIG.skills`, reused
 * via `skillStatParts`). The class-change quest's accept/change-class controls
 * used to live in this file's `ClassQuestAffordance` — that's gone; the WHOLE
 * quest flow now lives in `GoalLadder.tsx`'s `ClassQuestCard` (audit #1). */
function SkillButton({ hero, skill }: { hero: HeroSummary; skill: SkillSummary }) {
  const castSkill = useGameStore((s) => s.castSkill);
  const setAutoSlot = useGameStore((s) => s.setAutoSlot);
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");
  const skillName = tContent(`skills.${skill.id}.name`);
  const icon = SKILL_ICONS_BY_ID[skill.id] ?? "✦";
  const accent = HERO_ACCENT[hero.cls];
  const castKey = useCastKey(skill.cd);
  const skillDef = SKILLS[skill.id];
  const statsLine = skillStatParts(skillDef)
    .map((p) => tPanels(`skillStat.${p.key}`, p.values))
    .join(" · ");
  const detailText = `${tContent(`skills.${skill.id}.desc`)} · ${statsLine}`;

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
            detail — desc line + live numbers (mana/cooldown/damage/etc. off
            `CONFIG.skills` via `skillStatParts`). Sits OUTSIDE the cast
            `<button>` (siblings, not nested — nested buttons are invalid
            HTML) at its top-left corner; `InfoTip` already carries its own
            ≥44px hit-zone trick. */}
        <div className="absolute -top-1.5 -left-1.5 z-10">
          <InfoTip
            text={detailText}
            ariaLabel={tPanels("skillInfoAria", { skillName })}
          />
        </div>
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

/** Smoothly ticks a countdown DOWN in real time between throttled (~10Hz)
 * snapshot updates, instead of visually stair-stepping on each snapshot —
 * resyncs its own baseline every time `remaining` changes (a fresh snapshot
 * value, including a brand-new cast resetting it back up). Purely a display
 * interpolation; the engine's own `atkBuffTimer` stays the source of truth. */
function useSmoothCountdown(remaining: number): number {
  const [display, setDisplay] = useState(remaining);

  useEffect(() => {
    if (remaining <= 0) {
      // A zero-callback timeout defers the state update into a callback
      // (same accepted pattern as `usePulseOnIncrease`'s `setTimeout` below)
      // instead of calling `setState` synchronously in the effect body.
      const resetId = setTimeout(() => setDisplay(0), 0);
      return () => clearTimeout(resetId);
    }
    const startedAt = performance.now();
    const startValue = remaining;
    const resetId = setTimeout(() => setDisplay(remaining), 0);
    const tickId = setInterval(() => {
      const elapsedSec = (performance.now() - startedAt) / 1000;
      setDisplay(Math.max(0, startValue - elapsedSec));
    }, 100);
    return () => {
      clearTimeout(resetId);
      clearInterval(tickId);
    };
  }, [remaining]);

  return display;
}

/** Owner request: a small status-chip ROW near the HP/mana rows — built to
 * hold multiple future buff chips (each one self-contained), even though
 * War Cry is the only one today. Renders nothing while no buff is active
 * (`hero.atkBuffTimer <= 0`). */
function BuffChipRow({ hero }: { hero: HeroSummary }) {
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");
  const smoothSeconds = useSmoothCountdown(hero.atkBuffTimer);

  if (hero.atkBuffTimer <= 0) return null;

  const warCryName = tContent("skills.sword_warcry.name");
  const pct = Math.round((hero.atkBuffMult - 1) * 100);
  const secondsLeft = Math.max(0, Math.ceil(smoothSeconds));

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        title={tPanels("atkBuffTooltip", { percent: pct })}
        className="flex min-h-6 items-center gap-1 rounded-full border border-rose-500/60 bg-rose-950/50 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-rose-200 tabular-nums"
      >
        <span aria-hidden>⚔</span>
        <span className="line-clamp-1">{warCryName}</span>
        <span>{secondsLeft}s</span>
      </span>
    </div>
  );
}

/** Held mana-potion count pinned to the mana bar (M7.7 — potions are the
 * pool's refill loop now; surface the stock where the player watches drain). */
function ManaPotionBadge() {
  const count = useGameStore((s) => s.shop.counts.manaPotion ?? 0);
  return (
    <span
      className={`rounded px-1 text-[10px] leading-4 font-bold tabular-nums ${
        count === 0 ? "bg-rose-950/70 text-rose-300" : "bg-sky-950/70 text-sky-200"
      }`}
    >
      💧{count}
    </span>
  );
}

/** A hero's full skill panel: header, HP/XP/mana bars, and the skill kit. */
function HeroSkills({ hero }: { hero: HeroSummary }) {
  const tContent = useTranslations("content");
  const tCommon = useTranslations("common");
  const tPanels = useTranslations("panels");
  const heroName = tContent(`classes.${hero.cls}.${classNameKeyForTier(hero.tier)}`);
  const leveledUpPulse = usePulseOnIncrease(hero.level, 320);

  const hpPct = hero.maxHp > 0 ? Math.max(0, (hero.hp / hero.maxHp) * 100) : 0;
  const xpPct = Math.max(0, Math.min(1, hero.xpProgress)) * 100;
  const manaPct = hero.maxMana > 0 ? Math.max(0, (hero.mana / hero.maxMana) * 100) : 0;

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
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        <span
          title={heroName}
          className={`rounded-full border border-ddp-border-soft bg-black/60 px-2 py-0.5 text-xs font-bold tabular-nums ${
            hero.atLevelCap ? "text-ddp-gold-bright" : "text-ddp-ink-muted"
          } ${leveledUpPulse ? "animate-buy-pulse" : ""}`}
        >
          {hero.atLevelCap
            ? tCommon("maxLabel")
            : tCommon("levelBadge", { level: hero.level })}
        </span>
      </div>

      {/* HP bar */}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-black/50"
        title={heroName}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            hpPct > 35 ? "bg-emerald-400" : "bg-red-500"
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      {/* XP bar (gold = progress currency) */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-black/50"
        title={heroName}
      >
        <div
          className="h-full rounded-full bg-ddp-gold transition-[width] duration-300"
          style={{ width: `${hero.atLevelCap ? 100 : xpPct}%` }}
        />
      </div>
      {/* Mana bar (blue = caster resource) + a visible n/max readout. M7.7:
          mana is now the skill PACING GOVERNOR (skills spam-drain the pool;
          potions refill it), so the bar got promoted — taller, low-pool
          warning tint, and the held mana-potion count sits right beside it. */}
      <div className="flex w-full items-center gap-1">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/50">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${
              manaPct < 25 ? "animate-pulse bg-rose-400" : "bg-sky-400"
            }`}
            style={{ width: `${manaPct}%` }}
          />
        </div>
        <span
          className={`text-[11px] leading-none font-semibold tabular-nums ${
            manaPct < 25 ? "text-rose-300" : "text-sky-300/90"
          }`}
        >
          {Math.floor(hero.mana)}/{hero.maxMana}
        </span>
        <ManaPotionBadge />
      </div>

      <BuffChipRow hero={hero} />

      {/* The learned skill kit */}
      <div className="mt-1 flex flex-wrap items-start justify-center gap-2">
        {hero.skills.map((skill) => (
          <SkillButton key={skill.id} hero={hero} skill={skill} />
        ))}
      </div>
      {nextLockedLevel !== null && (
        <span className="text-[10px] text-ddp-ink-muted/70">
          {nextSlotNeedsHigherTier
            ? tPanels("autoSlotNextUnlockTier3", { level: nextLockedLevel })
            : tPanels("autoSlotNextUnlock", { level: nextLockedLevel })}
        </span>
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
    <div data-onboarding-anchor="skill-bar" className="flex flex-wrap items-start gap-3">
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("skillsLabel")}
      </span>
      <div className="flex gap-4">{hero && <HeroSkills hero={hero} />}</div>
      {/* The "Auto สกิล" master toggle moved into the consolidated bot-settings
          modal (owner UX pass, 2026-07-07 — see `BotSettingsModal.tsx`); this
          bar keeps only the per-skill "+ อัตโนมัติ" slot badges (an owner-
          approved shortcut that mirrors the same store state). */}
    </div>
  );
}
