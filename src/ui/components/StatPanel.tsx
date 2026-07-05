"use client";

/**
 * Base-stat panel (M5 "Base stats"): per-stat +buttons, an unspent-points badge,
 * an auto-allocate toggle, and the combat-power ("พลังต่อสู้") readout for the solo
 * hero. Functional-plain on purpose — the pretty pass lands with the goal-ladder
 * UI in M6. Mirrors the SkillBar's dock conventions (label + chips + trailing
 * toggle). All numbers come from the throttled `HeroSummary` snapshot; a +tap
 * queues an `allocateStat` intent (drained once per real frame, like evolve).
 */

import { useTranslations } from "next-intl";
import type { StatKey } from "@/engine";
import type { HeroSummary } from "@/ui/store/gameStore";
import { useGameStore } from "@/ui/store/gameStore";

/** Fixed display order (str/dex/int/vit). */
const STAT_ORDER: readonly StatKey[] = ["str", "dex", "int", "vit"];

function StatRow({ hero, stat }: { hero: HeroSummary; stat: StatKey }) {
  const allocateStat = useGameStore((s) => s.allocateStat);
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const t = useTranslations("stats");

  const value = hero.stats[stat];
  const isPrimary = hero.primaryStat === stat;
  // +1 is available only when there are unspent points and auto-allocate is off
  // (auto owns the primary stat; a manual tap would race it every frame).
  const canAdd = hero.statPoints > 0 && !autoAllocate;

  return (
    <div className="flex items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-2 py-1">
      <div className="flex flex-col leading-none">
        <span
          className={`text-[10px] font-bold ${isPrimary ? "text-ddp-gold-bright" : "text-ddp-ink"}`}
          title={`${t(`full.${stat}`)} — ${t(`effect.${stat}`)}`}
        >
          {t(`names.${stat}`)}
          {isPrimary && (
            <span className="ml-1 align-middle text-[7px] font-semibold text-ddp-gold-bright/80 uppercase">
              {t("primaryTag")}
            </span>
          )}
        </span>
        <span className="text-[11px] font-bold tabular-nums text-ddp-ink">{value}</span>
      </div>
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => allocateStat(stat, 1)}
        aria-label={t("allocateAria", { stat: t(`full.${stat}`) })}
        className={`ml-auto grid h-6 w-6 place-items-center rounded-full border text-sm font-bold leading-none transition-transform duration-100 active:scale-90 ${
          canAdd
            ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
            : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
        }`}
      >
        +
      </button>
    </div>
  );
}

export function StatPanel() {
  const heroes = useGameStore((s) => s.heroes);
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const toggleAutoAllocate = useGameStore((s) => s.toggleAutoAllocate);
  const t = useTranslations("stats");

  // Solo gameplay: the stat panel drives the single active character.
  const hero = heroes[0];
  if (!hero) return null;

  return (
    <div data-onboarding-anchor="stat-panel" className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </span>

      {hero.statPoints > 0 && (
        <span
          className="animate-buy-pulse rounded-full border border-ddp-gold/60 bg-ddp-gold/15 px-2 py-0.5 text-[10px] font-bold text-ddp-gold-bright tabular-nums"
          title={t("pointsTitle")}
        >
          {t("pointsBadge", { count: hero.statPoints })}
        </span>
      )}

      <span className="rounded-full border border-ddp-border-soft bg-black/50 px-2 py-0.5 text-[10px] font-bold text-ddp-ink tabular-nums">
        {t("combatPower")}: {hero.combatPower.toLocaleString()}
      </span>

      <div className="flex flex-wrap gap-1.5">
        {STAT_ORDER.map((stat) => (
          <StatRow key={stat} hero={hero} stat={stat} />
        ))}
      </div>

      <div className="flex-1" />

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
    </div>
  );
}
