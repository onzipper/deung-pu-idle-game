"use client";

/**
 * Auto-use settings (M6 "เมืองหลัก") — two compact rows (hp / mana) each with an
 * on/off toggle and a threshold stepper (fires the auto-use when the pool drops
 * below the % of its max). UI-owned like `autoCast`: GameClient mirrors these onto
 * the engine state each frame (not `FrameInput`, never persisted).
 *
 * Lives in the settings-row area of the console dock. Icons are pre-2015 emoji
 * (Win10-safe — footgun #4).
 */

import { useTranslations } from "next-intl";

import { useGameStore } from "@/ui/store/gameStore";

const STEP = 0.05;

function AutoPotionRow({
  icon,
  label,
  on,
  threshold,
  onToggle,
  onThreshold,
}: {
  icon: string;
  label: string;
  on: boolean;
  threshold: number;
  onToggle: () => void;
  onThreshold: (frac: number) => void;
}) {
  const t = useTranslations("shop");
  const pct = Math.round(threshold * 100);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={t("autoUseAria", { name: label, state: on ? "on" : "off" })}
        className={`inline-flex min-h-9 items-center gap-1 rounded-(--ddp-radius-md) border px-2 py-1 text-xs font-bold transition-colors ${
          on
            ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300"
            : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
        }`}
      >
        <span aria-hidden>{icon}</span>
        <span className="text-[10px]">{t("autoLabel")}</span>
      </button>
      <div
        className={`flex items-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 ${
          on ? "" : "opacity-40"
        }`}
      >
        <button
          type="button"
          disabled={!on}
          onClick={() => onThreshold(threshold - STEP)}
          aria-label={t("thresholdDownAria", { name: label })}
          className="min-h-9 w-6 text-sm font-black text-ddp-ink-muted disabled:cursor-not-allowed"
        >
          −
        </button>
        <span className="w-9 text-center text-[11px] font-bold tabular-nums text-ddp-ink">
          {pct}%
        </span>
        <button
          type="button"
          disabled={!on}
          onClick={() => onThreshold(threshold + STEP)}
          aria-label={t("thresholdUpAria", { name: label })}
          className="min-h-9 w-6 text-sm font-black text-ddp-ink-muted disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function AutoPotionToggles() {
  const autoHpPotion = useGameStore((s) => s.autoHpPotion);
  const autoManaPotion = useGameStore((s) => s.autoManaPotion);
  const autoHpThreshold = useGameStore((s) => s.autoHpThreshold);
  const autoManaThreshold = useGameStore((s) => s.autoManaThreshold);
  const toggleHp = useGameStore((s) => s.toggleAutoHpPotion);
  const toggleMana = useGameStore((s) => s.toggleAutoManaPotion);
  const setHp = useGameStore((s) => s.setAutoHpThreshold);
  const setMana = useGameStore((s) => s.setAutoManaThreshold);
  const t = useTranslations("shop");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AutoPotionRow
        icon="❤"
        label={t("hpLabel")}
        on={autoHpPotion}
        threshold={autoHpThreshold}
        onToggle={toggleHp}
        onThreshold={setHp}
      />
      <AutoPotionRow
        icon="💧"
        label={t("manaLabel")}
        on={autoManaPotion}
        threshold={autoManaThreshold}
        onToggle={toggleMana}
        onThreshold={setMana}
      />
    </div>
  );
}
