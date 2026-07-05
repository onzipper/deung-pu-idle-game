"use client";

/**
 * Per-hero skill buttons (cast + cooldown sweep) and the auto-cast toggle.
 *
 * The cooldown sweep is pure CSS: a linear `height` animation whose duration
 * is the skill's max cooldown and whose `animation-delay` is negative by the
 * ALREADY-elapsed amount, so it visually resumes at the right point from a
 * single throttled snapshot value instead of a 60 Hz store write. It only
 * restarts (remounts via `key`) when a fresh cast is detected. The keyframes
 * (`ddp-cooldown-sweep`, `ddp-invite-glow`) live in globals.css alongside the
 * rest of the HUD's shared animation vocabulary.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HeroClass } from "@/engine";
import { CONFIG, SKILL_TYPES } from "@/engine";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import type { HeroSummary } from "@/ui/store/gameStore";
import { SKILL_ICONS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

/** Below this level the evolve affordance isn't shown at all (don't tease the
 * feature before it's remotely relevant) — from here to
 * `CONFIG.evolution.levelRequired` it shows as a disabled "locked" hint. */
const EVOLVE_HINT_LEVEL = 12;

/** How long an armed (first-tap) evolve button stays armed before it resets —
 * a stray tap minutes later should never silently fire the second half of a
 * two-tap confirm. */
const EVOLVE_ARM_TIMEOUT_MS = 3000;

/** Presentational-only per-class accent (mirrors src/render/theme.ts
 * HERO_COLORS so a hero's skill button reads as "the same character" as
 * their in-canvas sprite) — never fed back into the engine, purely a local
 * styling constant. `soft` is a pre-mixed rgba so button classes never need a
 * Tailwind opacity-modifier on an arbitrary CSS-var color (unsupported
 * combination) — just a plain var() substitution. */
const HERO_ACCENT: Record<HeroClass, { solid: string; soft: string }> = {
  swordsman: { solid: "#35d0c0", soft: "rgba(53, 208, 192, 0.55)" },
  archer: { solid: "#b8e04a", soft: "rgba(184, 224, 74, 0.55)" },
  mage: { solid: "#c77dff", soft: "rgba(199, 125, 255, 0.55)" },
};

/** Detects a fresh cast (skillCd jumped back up) to restart the CSS sweep. */
function useCastKey(skillCd: number): number {
  const prev = useRef(skillCd);
  const [castKey, setCastKey] = useState(0);
  useEffect(() => {
    if (skillCd > prev.current + 0.05) {
      setCastKey((k) => k + 1);
    }
    prev.current = skillCd;
  }, [skillCd]);
  return castKey;
}

/**
 * Class-advancement (M5 evolution) affordance, rendered next to the level
 * badge (`SkillButton`'s top row). Three states:
 *  - hidden entirely below `EVOLVE_HINT_LEVEL` (don't tease the feature too
 *    early),
 *  - a disabled "locked" hint pill from `EVOLVE_HINT_LEVEL` up to
 *    `CONFIG.evolution.levelRequired` (shows the level/gold requirement, so
 *    the player knows it's coming and what it costs),
 *  - once the level gate is met: a real button. This is a big one-way
 *    purchase (permanent tier flip), so it needs a confirm — the codebase has
 *    no existing purchase-confirm pattern to match (upgrades/skills are cheap
 *    and instantly repeatable), so this uses a 2-tap "tap again to confirm"
 *    arm/fire pattern local to the button, auto-disarming after
 *    `EVOLVE_ARM_TIMEOUT_MS` so a stray tap minutes later can't silently fire
 *    the confirm half.
 * Tier-2 heroes get a static evolved-identity badge instead (no more
 * evolutions in M5 — see `engine/systems/evolution.ts`'s single-path note).
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
        // The level gate is already met here (the "locked" ICU branch above
        // is only for the separate below-level-gate hint pill); an
        // unaffordable-but-level-met button just reads its cost, same
        // convention as `UpgradePanel.tsx`'s `upgradeAriaLabel`.
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

function SkillButton({ hero, slot }: { hero: HeroSummary; slot: number }) {
  const castSkill = useGameStore((s) => s.castSkill);
  const maxCd = SKILL_TYPES[hero.cls].cd;
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");
  const tCommon = useTranslations("common");
  const skillName = tContent(`skills.${hero.cls}.name`);
  // Tier-2 (evolved) heroes read as their evolved class identity everywhere
  // this string is used (badge tooltip, aria-label) — same source of truth
  // as the `HeroSummary.tier` snapshot field (M5 evolution).
  const heroName = tContent(`classes.${hero.cls}.${hero.tier === 2 ? "evolvedName" : "name"}`);
  const skillIcon = SKILL_ICONS[hero.cls];
  const castKey = useCastKey(hero.skillCd);
  const accent = HERO_ACCENT[hero.cls];
  // M5 "Character XP + Level system": brief scale/glow pulse the instant this
  // hero's level increments (same one-shot CSS pattern `UpgradePanel.tsx`
  // uses for a bought upgrade) — the FX-layer starburst/chime lives in
  // `render/fx/levelUp.ts`/`audio/sfxMap.ts`, this is purely the HUD-side echo.
  const leveledUpPulse = usePulseOnIncrease(hero.level, 320);

  const ready = hero.skillCd <= 0 && !hero.dead;
  const delay = -(maxCd - hero.skillCd);
  const hpPct = hero.maxHp > 0 ? Math.max(0, (hero.hp / hero.maxHp) * 100) : 0;
  const xpPct = Math.max(0, Math.min(1, hero.xpProgress)) * 100;
  const cdSeconds = Math.ceil(hero.skillCd);
  const status = hero.dead ? "dead" : ready ? "none" : "cooldown";

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
      <div
        className="h-1.5 w-14 overflow-hidden rounded-full bg-black/50"
        title={heroName}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            hpPct > 35 ? "bg-emerald-400" : "bg-red-500"
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      {/* Slim XP bar (M5) — gold to read as "progress currency", distinct
          from the hp bar's green/red health read. Full+static at level cap
          (no MAX pill here; the badge above already carries that state). */}
      <div className="h-1 w-14 overflow-hidden rounded-full bg-black/50" title={heroName}>
        <div
          className="h-full rounded-full bg-ddp-gold transition-[width] duration-300"
          style={{ width: `${hero.atLevelCap ? 100 : xpPct}%` }}
        />
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => castSkill(slot)}
        aria-label={tPanels("skillAriaLabel", { heroName, skillName, status, seconds: cdSeconds })}
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
          <span className="text-xl leading-none">{skillIcon}</span>
          <span className="mt-1 text-[9px] leading-none text-ddp-ink-muted">{skillName}</span>
          {hero.skillCd > 0 && !hero.dead && (
            <span
              key={castKey}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 [animation-name:ddp-cooldown-sweep] [animation-timing-function:linear] [animation-fill-mode:forwards]"
              style={{ animationDuration: `${maxCd}s`, animationDelay: `${delay}s` }}
            />
          )}
          {hero.skillCd > 0 && !hero.dead && (
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
    </div>
  );
}

export function SkillBar() {
  const heroes = useGameStore((s) => s.heroes);
  const autoCast = useGameStore((s) => s.autoCast);
  const toggleAutoCast = useGameStore((s) => s.toggleAutoCast);
  const t = useTranslations("panels");

  return (
    <div data-onboarding-anchor="skill-bar" className="flex flex-wrap items-center gap-3">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("skillsLabel")}
      </span>
      <div className="flex gap-2">
        {heroes.map((hero, i) => (
          <SkillButton key={i} hero={hero} slot={i} />
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
