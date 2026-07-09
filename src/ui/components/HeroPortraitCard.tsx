"use client";

/**
 * R2-W2 "fullscreen HUD": the mockup's top-left portrait card — class roundel
 * (glyph, no painted art — R1 "code-only art" gate) + Lv corner badge + name +
 * power, HP/MP/EXP stacked via the shared `StatBar` primitive. EXTRACTED
 * verbatim out of `SkillBar.tsx`'s old `HeroSkills` (same throttled
 * `HeroSummary` fields, same markup/classes, zero behavior change) so it can
 * mount as its OWN absolute top-left overlay card instead of sitting inline
 * above the skill kit — the skill kit itself stays in the bottom dock
 * (`SkillBar.tsx`).
 */

import { useTranslations } from "next-intl";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { StatBar } from "@/ui/components/primitives/StatBar";
import type { HeroSummary } from "@/ui/store/gameStore";
import { HERO_ACCENT, HERO_ICONS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

/** The `content.classes.<cls>.<key>` i18n key for hero.tier's display name:
 * tier 1 = base name, tier 2 = `evolvedName`, tier 3 = `tier3Name` (M7.9
 * grand-expansion final form). Mirrors `SkillBar.tsx`'s identically-named
 * helper (kept as its own copy — the two files are otherwise decoupled). */
function classNameKeyForTier(tier: 1 | 2 | 3): "name" | "evolvedName" | "tier3Name" {
  if (tier === 2) return "evolvedName";
  if (tier === 3) return "tier3Name";
  return "name";
}

/** Held mana-potion count pinned to the mana bar (M7.7 — potions are the
 * pool's refill loop now; surface the stock where the player watches drain).
 * Mirrors `SkillBar.tsx`'s identically-named component. */
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

function PortraitCardInner({ hero }: { hero: HeroSummary }) {
  const tContent = useTranslations("content");
  const tCommon = useTranslations("common");
  const tPanels = useTranslations("panels");
  const tStats = useTranslations("stats");
  const heroName = tContent(`classes.${hero.cls}.${classNameKeyForTier(hero.tier)}`);
  const leveledUpPulse = usePulseOnIncrease(hero.level, 320);
  const accent = HERO_ACCENT[hero.cls];

  const xpPct = Math.max(0, Math.min(1, hero.xpProgress)) * 100;

  return (
    <div className="flex w-56 max-w-[70vw] items-center gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-black/45 px-2.5 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm sm:w-64">
      <div
        aria-hidden
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-black/50 shadow-(--ddp-shadow-btn) sm:h-12 sm:w-12"
        style={{ borderColor: accent.solid, boxShadow: `0 0 10px 2px ${accent.soft}` }}
      >
        <span className="text-xl leading-none">{HERO_ICONS[hero.cls]}</span>
        <span
          title={heroName}
          className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-ddp-border-soft bg-black/90 px-1.5 py-0.5 text-[9px] leading-none font-black tabular-nums whitespace-nowrap ${
            hero.atLevelCap ? "text-ddp-gold-bright" : "text-ddp-ink"
          } ${leveledUpPulse ? "animate-buy-pulse" : ""}`}
        >
          {hero.atLevelCap ? tCommon("maxLabel") : tCommon("levelBadge", { level: hero.level })}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-bold text-ddp-ink" title={heroName}>
            {heroName}
          </span>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ddp-ink-muted">
            {tStats("combatPower")}{" "}
            <span className="text-ddp-gold-bright">{hero.combatPower.toLocaleString()}</span>
          </span>
        </div>
        <StatBar
          variant="hp"
          value={hero.hp}
          max={hero.maxHp}
          height="sm"
          label={tPanels("hpBarLabel")}
          valueText={`${Math.ceil(hero.hp)}/${Math.ceil(hero.maxHp)}`}
        />
        <div className="flex w-full items-center gap-1">
          <StatBar
            variant="mp"
            value={hero.mana}
            max={hero.maxMana}
            height="sm"
            label={tPanels("mpBarLabel")}
            valueText={`${Math.floor(hero.mana)}/${hero.maxMana}`}
            className="flex-1"
          />
          <ManaPotionBadge />
        </div>
        <StatBar
          variant="exp"
          value={hero.atLevelCap ? 100 : xpPct}
          max={100}
          height="sm"
          label={tPanels("expBarLabel")}
        />
      </div>
    </div>
  );
}

export function HeroPortraitCard() {
  const hero = useGameStore((s) => s.heroes[0]);
  if (!hero) return null;
  return <PortraitCardInner hero={hero} />;
}
