"use client";

/**
 * Per-hero skill KIT (M5 "mana + skill framework v2"): a mana bar plus a button
 * per LEARNED skill (cost + cooldown sweep, disabled when unaffordable / on
 * cooldown / dead), and a simple auto-slot assignment (tap a skill's AUTO badge
 * to toggle it into a free unlocked auto-cast slot). The level badge, HP/XP bars,
 * and evolve affordance carry over from the pre-v2 bar.
 *
 * The cooldown sweep is pure CSS: a linear `height` animation whose duration is
 * the skill's max cooldown and whose `animation-delay` is negative by the
 * ALREADY-elapsed amount, so it visually resumes at the right point from a single
 * throttled snapshot value. It only restarts (remounts via `key`) on a fresh cast.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HeroClass } from "@/engine";
import { CONFIG } from "@/engine";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import type { HeroSummary, SkillSummary } from "@/ui/store/gameStore";
import { SKILL_ICONS_BY_ID } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

/** Below this level the evolve affordance isn't shown at all (don't tease the
 * feature before it's remotely relevant) — from here to
 * `CONFIG.evolution.levelRequired` it shows as a disabled "locked" hint. */
const EVOLVE_HINT_LEVEL = 12;

/** How long an armed (first-tap) evolve button stays armed before it resets. */
const EVOLVE_ARM_TIMEOUT_MS = 3000;

/** Presentational-only per-class accent (mirrors src/render/theme.ts
 * HERO_COLORS). `soft` is a pre-mixed rgba so button classes never need a
 * Tailwind opacity-modifier on an arbitrary CSS-var color. */
const HERO_ACCENT: Record<HeroClass, { solid: string; soft: string }> = {
  swordsman: { solid: "#35d0c0", soft: "rgba(53, 208, 192, 0.55)" },
  archer: { solid: "#b8e04a", soft: "rgba(184, 224, 74, 0.55)" },
  mage: { solid: "#c77dff", soft: "rgba(199, 125, 255, 0.55)" },
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

/**
 * Class-advancement (M5 evolution) affordance, rendered next to the level badge.
 * (Unchanged from the pre-v2 bar — see the two-tap confirm rationale inline.)
 */
function EvolveAffordance({
  hero,
  slot,
  heroName,
  accent,
}: {
  hero: HeroSummary;
  slot: number;
  heroName: string;
  accent: { solid: string; soft: string };
}) {
  const evolveHero = useGameStore((s) => s.evolveHero);
  const tPanels = useTranslations("panels");
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  if (hero.tier === 2) {
    return (
      <span
        title={tPanels("evolvedBadgeTitle", { name: heroName })}
        className="rounded-full border border-ddp-gold/60 bg-ddp-gold/10 px-1.5 text-[8px] font-bold text-ddp-gold-bright"
      >
        {heroName}
      </span>
    );
  }

  if (hero.level < EVOLVE_HINT_LEVEL) return null;

  const levelGateMet = hero.level >= CONFIG.evolution.levelRequired;
  if (!levelGateMet) {
    return (
      <span
        title={tPanels("evolveLockedHint", {
          level: CONFIG.evolution.levelRequired,
          cost: hero.evolutionCost.toLocaleString(),
        })}
        aria-label={tPanels("evolveAriaLabel", {
          heroName,
          state: "locked",
          level: CONFIG.evolution.levelRequired,
          cost: hero.evolutionCost.toLocaleString(),
        })}
        className="cursor-default rounded-full border border-ddp-border bg-black/40 px-1.5 text-[8px] font-bold text-ddp-ink-muted"
      >
        🔒 Lv.{CONFIG.evolution.levelRequired}
      </span>
    );
  }

  const affordable = hero.canEvolve;

  function handleClick(): void {
    if (!affordable) return;
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), EVOLVE_ARM_TIMEOUT_MS);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
    evolveHero(slot);
  }

  function disarm(): void {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
  }

  return (
    <button
      type="button"
      disabled={!affordable}
      onClick={handleClick}
      onBlur={disarm}
      onMouseLeave={() => armed && disarm()}
      title={armed ? tPanels("evolveConfirmHint") : undefined}
      style={{ "--accent": accent.solid, "--accent-soft": accent.soft } as CSSProperties}
      aria-label={tPanels("evolveAriaLabel", {
        heroName,
        state: armed ? "confirm" : "normal",
        level: CONFIG.evolution.levelRequired,
        cost: hero.evolutionCost.toLocaleString(),
      })}
      className={`relative rounded-full border px-1.5 text-[8px] font-bold whitespace-nowrap transition-all duration-100 active:scale-95 ${
        armed
          ? "animate-buy-pulse border-ddp-gold bg-ddp-gold text-ddp-panel-strong"
          : affordable
            ? "border-(--accent-soft) bg-ddp-panel-strong text-ddp-gold-bright before:absolute before:-inset-0.5 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_10px_2px_var(--accent-soft)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.6s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-['']"
            : "cursor-not-allowed border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted grayscale"
      }`}
    >
      {armed ? tPanels("evolveConfirmLabel") : tPanels("evolveButton")}
    </button>
  );
}

/** One learned skill: a cast button + an AUTO-slot toggle badge. */
function SkillButton({ hero, skill }: { hero: HeroSummary; skill: SkillSummary }) {
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
  const status = hero.dead ? "dead" : ready ? "none" : skill.cd > 0 ? "cooldown" : "nomana";

  const inSlot = skill.autoSlot !== null;
  const firstFreeSlot = hero.autoSlots.findIndex((id, i) => i < hero.unlockedSlots && id === null);
  const canToggleAuto = inSlot || firstFreeSlot >= 0;

  function toggleAuto(): void {
    if (inSlot) setAutoSlot(skill.autoSlot!, null);
    else if (firstFreeSlot >= 0) setAutoSlot(firstFreeSlot, skill.id);
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
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
        style={{ "--accent": accent.solid, "--accent-soft": accent.soft } as CSSProperties}
        className={`relative h-16 w-16 rounded-(--ddp-radius-md) border shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.96] ${
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
          <span className="text-xl leading-none">{icon}</span>
          <span className="mt-0.5 text-[8px] leading-tight text-ddp-ink-muted">{skillName}</span>
          <span
            className={`text-[8px] leading-none tabular-nums ${
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
              style={{ animationDuration: `${skill.maxCd}s`, animationDelay: `${delay}s` }}
            />
          )}
          {skill.cd > 0 && !hero.dead && (
            <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-black/60 px-1 text-[9px] font-bold text-ddp-ink tabular-nums">
              {cdSeconds}
            </span>
          )}
          {hero.dead && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] font-bold text-red-400">
              {tPanels("heroDeadBadge")}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={toggleAuto}
        disabled={!canToggleAuto}
        aria-pressed={inSlot}
        title={tPanels("autoSlotToggleHint")}
        className={`w-16 rounded-full border px-1 py-0.5 text-[8px] font-bold transition-colors ${
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

/** A hero's full skill panel: header, HP/XP/mana bars, and the skill kit. */
function HeroSkills({ hero, slot }: { hero: HeroSummary; slot: number }) {
  const tContent = useTranslations("content");
  const tCommon = useTranslations("common");
  const tPanels = useTranslations("panels");
  const heroName = tContent(`classes.${hero.cls}.${hero.tier === 2 ? "evolvedName" : "name"}`);
  const accent = HERO_ACCENT[hero.cls];
  const leveledUpPulse = usePulseOnIncrease(hero.level, 320);

  const hpPct = hero.maxHp > 0 ? Math.max(0, (hero.hp / hero.maxHp) * 100) : 0;
  const xpPct = Math.max(0, Math.min(1, hero.xpProgress)) * 100;
  const manaPct = hero.maxMana > 0 ? Math.max(0, (hero.mana / hero.maxMana) * 100) : 0;

  // Next locked auto-slot's unlock level (for the "more slots at Lv.X" hint).
  const nextLockedLevel =
    hero.unlockedSlots < CONFIG.autoSlots.max
      ? CONFIG.autoSlots.unlockLevels[hero.unlockedSlots]
      : null;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1">
        <span
          title={heroName}
          className={`rounded-full border border-ddp-border-soft bg-black/60 px-1.5 text-[9px] font-bold tabular-nums ${
            hero.atLevelCap ? "text-ddp-gold-bright" : "text-ddp-ink-muted"
          } ${leveledUpPulse ? "animate-buy-pulse" : ""}`}
        >
          {hero.atLevelCap ? tCommon("maxLabel") : tCommon("levelBadge", { level: hero.level })}
        </span>
        <EvolveAffordance hero={hero} slot={slot} heroName={heroName} accent={accent} />
      </div>

      {/* HP bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/50" title={heroName}>
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            hpPct > 35 ? "bg-emerald-400" : "bg-red-500"
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      {/* XP bar (gold = progress currency) */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-black/50" title={heroName}>
        <div
          className="h-full rounded-full bg-ddp-gold transition-[width] duration-300"
          style={{ width: `${hero.atLevelCap ? 100 : xpPct}%` }}
        />
      </div>
      {/* Mana bar (blue = caster resource) */}
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-black/50"
        title={tPanels("manaLabel", { mana: Math.floor(hero.mana), max: hero.maxMana })}
      >
        <div
          className="h-full rounded-full bg-sky-400 transition-[width] duration-150"
          style={{ width: `${manaPct}%` }}
        />
      </div>

      {/* The learned skill kit */}
      <div className="mt-1 flex flex-wrap items-start justify-center gap-2">
        {hero.skills.map((skill) => (
          <SkillButton key={skill.id} hero={hero} skill={skill} />
        ))}
      </div>
      {nextLockedLevel !== null && (
        <span className="text-[8px] text-ddp-ink-muted/70">
          {tPanels("autoSlotNextUnlock", { level: nextLockedLevel })}
        </span>
      )}
    </div>
  );
}

export function SkillBar() {
  const heroes = useGameStore((s) => s.heroes);
  const autoCast = useGameStore((s) => s.autoCast);
  const toggleAutoCast = useGameStore((s) => s.toggleAutoCast);
  const t = useTranslations("panels");

  return (
    <div data-onboarding-anchor="skill-bar" className="flex flex-wrap items-start gap-3">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("skillsLabel")}
      </span>
      <div className="flex gap-4">
        {heroes.map((hero, i) => (
          <HeroSkills key={i} hero={hero} slot={i} />
        ))}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={toggleAutoCast}
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
        {/* ✨ not 🪄: the magic-wand emoji (Unicode 13) has no glyph on Windows 10 */}
        {t("autoSkillToggle", { state: autoCast ? "on" : "off" })}
      </button>
    </div>
  );
}
