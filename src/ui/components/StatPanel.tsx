"use client";

/**
 * Base-stat panel (M5 "Base stats"): per-stat +buttons, an unspent-points badge,
 * and the combat-power ("พลังต่อสู้") readout for the solo hero. All numbers come
 * from the throttled `HeroSummary` snapshot; a +tap queues an `allocateStat`
 * intent (drained once per real frame, like evolve). The auto-allocate ON/OFF
 * toggle itself moved into the settings drawer (M6 settings-panel task,
 * `SettingsPanel.tsx`) — this panel still READS `autoAllocate` (below) to
 * disable manual +taps while it's on, since auto owns the primary stat then.
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
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-2.5 py-1.5">
      <div className="flex flex-col leading-tight">
        <span
          className={`text-xs font-bold ${isPrimary ? "text-ddp-gold-bright" : "text-ddp-ink"}`}
          title={`${t(`full.${stat}`)} — ${t(`effect.${stat}`)}`}
        >
          {t(`names.${stat}`)}
          {isPrimary && (
            <span className="ml-1 align-middle text-[9px] font-semibold text-ddp-gold-bright/80 uppercase">
              {t("primaryTag")}
            </span>
          )}
        </span>
        <span className="text-sm font-bold tabular-nums text-ddp-ink">{value}</span>
      </div>
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => allocateStat(stat, 1)}
        aria-label={t("allocateAria", { stat: t(`full.${stat}`) })}
        className={`ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg font-bold leading-none transition-transform duration-100 active:scale-90 ${
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
  const t = useTranslations("stats");

  // Solo gameplay: the stat panel drives the single active character.
  const hero = heroes[0];
  if (!hero) return null;

  return (
    <div
      data-onboarding-anchor="stat-panel"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </span>

      {hero.statPoints > 0 && (
        <span
          className="animate-buy-pulse rounded-full border border-ddp-gold/60 bg-ddp-gold/15 px-2.5 py-1 text-xs font-bold text-ddp-gold-bright tabular-nums"
          title={t("pointsTitle")}
        >
          {t("pointsBadge", { count: hero.statPoints })}
        </span>
      )}

      <span className="rounded-full border border-ddp-border-soft bg-black/50 px-2.5 py-1 text-xs font-bold text-ddp-ink tabular-nums">
        {t("combatPower")}: {hero.combatPower.toLocaleString()}
      </span>

      <div className="flex flex-wrap gap-1.5">
        {STAT_ORDER.map((stat) => (
          <StatRow key={stat} hero={hero} stat={stat} />
        ))}
      </div>
    </div>
  );
}
