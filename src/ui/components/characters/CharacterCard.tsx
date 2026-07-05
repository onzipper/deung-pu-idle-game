"use client";

/**
 * One roster card: class icon/name, level, combat power, created date, and
 * the เลือกเล่น/ลบ actions. Mobile-first — cards stack full-width (the parent
 * grid collapses to 1 column below `sm`).
 */

import { useLocale, useTranslations } from "next-intl";
import { HERO_ICONS } from "@/ui/labels";
import type { CharacterDTO } from "@/ui/components/characters/types";

export interface CharacterCardProps {
  character: CharacterDTO;
  selecting: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
}

export function CharacterCard({ character, selecting, onSelect, onRequestDelete }: CharacterCardProps) {
  const t = useTranslations("characters");
  const tCommon = useTranslations("common");
  const tContent = useTranslations("content");
  const tStats = useTranslations("stats");
  const locale = useLocale();

  const createdDate = new Date(character.createdAt).toLocaleDateString(
    locale === "th" ? "th-TH-u-ca-gregory" : "en-US",
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <div className="flex flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-3.5 shadow-(--ddp-shadow-panel)">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-2xl leading-none">
          {HERO_ICONS[character.baseClass]}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-extrabold text-ddp-ink">{character.name}</span>
          <span className="text-[11px] font-semibold text-ddp-ink-muted">
            {tContent(`classes.${character.baseClass}.name`)}
          </span>
        </div>
        <span className="rounded-full border border-ddp-border-soft bg-black/40 px-2 py-0.5 text-[11px] font-bold text-ddp-gold-bright tabular-nums">
          {tCommon("levelBadge", { level: character.level })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ddp-ink-muted">
        <span className="rounded-full border border-ddp-border-soft bg-black/30 px-2 py-0.5 font-bold tabular-nums text-ddp-ink">
          {tStats("combatPower")}: {character.power.toLocaleString()}
        </span>
        <span>{t("card.createdAtLabel", { date: createdDate })}</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSelect}
          disabled={selecting}
          className={`min-h-11 flex-1 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-extrabold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
            selecting
              ? "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
              : "border-emerald-400 bg-emerald-400 text-emerald-950"
          }`}
        >
          {selecting ? t("card.selecting") : t("card.playButton")}
        </button>
        <button
          type="button"
          onClick={onRequestDelete}
          disabled={selecting}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-black/30 px-3 py-2 text-xs font-bold text-ddp-bad hover:bg-ddp-bad/10"
        >
          {t("card.deleteButton")}
        </button>
      </div>
    </div>
  );
}
