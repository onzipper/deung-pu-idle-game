"use client";

/**
 * M7.5→M7.9 auto-dispose rules — the town-trip bot's per-rarity toggle
 * (off/sell) + keep-guard. localStorage-persisted UI preference
 * (`readStoredAutoSellRules`'s doc, `gameStore.ts`), same tier as
 * `soundMuted`: the rules THEMSELVES aren't game progress, only the bot's own
 * `state.bot` config is engine-persisted. Epic (M7.9 "option A") is its own
 * toggle defaulting OFF (keep) — existing players see no behavior change until
 * they opt in — but its "กันของดี" keep-guard protection is FORCED ON
 * regardless of the shared `keepBetterStat` toggle below (see
 * `ui/gear/autoSell.ts`'s `isGuarded`).
 *
 * Owner request 2026-07-08 (หินเสริมพลัง final wave): salvage is RETIRED
 * (refine stones now drop directly from mobs instead), so the per-rarity
 * action is a plain off/sell toggle (was a 3-way off/sell/salvage through
 * M7.7-M7.9) — a previously-persisted "salvage" value gracefully falls back
 * to this rarity's default (see `isAutoSellAction`'s doc, `gameStore.ts`);
 * nothing migrates it to "sell" automatically.
 *
 * The per-rarity control reuses `LocaleSwitch.tsx`'s exact segmented-button
 * visual language (an existing exclusive-choice pattern in this HUD) rather
 * than inventing a new one — the owner rejected a restyle here previously.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  readStoredAutoSellRules,
  useGameStore,
  type AutoSellAction,
} from "@/ui/store/gameStore";

const ACTIONS: AutoSellAction[] = ["off", "sell"];

function RaritySegment({
  label,
  value,
  onChange,
  actionLabel,
}: {
  label: string;
  value: AutoSellAction;
  onChange: (action: AutoSellAction) => void;
  actionLabel: (action: AutoSellAction) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-22 text-xs font-semibold text-ddp-ink">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-1 shadow-(--ddp-shadow-btn)"
      >
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            role="radio"
            aria-checked={value === action}
            onClick={() => onChange(action)}
            className={`min-h-11 min-w-11 rounded-[calc(var(--ddp-radius-md)-0.25rem)] px-3 py-1.5 text-xs font-bold transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] ${
              value === action
                ? "bg-emerald-400 text-emerald-950 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                : "bg-transparent text-ddp-ink-muted hover:text-ddp-ink"
            }`}
          >
            {actionLabel(action)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AutoSellRulesSection() {
  const autoSellCommon = useGameStore((s) => s.autoSellCommon);
  const autoSellRare = useGameStore((s) => s.autoSellRare);
  const autoSellEpic = useGameStore((s) => s.autoSellEpic);
  const autoSellKeepBetterStat = useGameStore((s) => s.autoSellKeepBetterStat);
  const setCommon = useGameStore((s) => s.setAutoSellCommon);
  const setRare = useGameStore((s) => s.setAutoSellRare);
  const setEpic = useGameStore((s) => s.setAutoSellEpic);
  const toggleKeepBetter = useGameStore((s) => s.toggleAutoSellKeepBetterStat);
  const hydrate = useGameStore((s) => s.hydrateAutoSellRules);
  const t = useTranslations("settings.autoSell");

  // Apply the persisted rules once, AFTER hydration — same "don't read
  // localStorage during the initial render" rule as `SoundToggle.tsx`.
  useEffect(() => {
    hydrate(readStoredAutoSellRules());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  const actionLabel = (action: AutoSellAction): string =>
    action === "off" ? t("actionOff") : t("actionSell");

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </h3>
      <div className="flex flex-col gap-2">
        <RaritySegment
          label={t("commonLabel")}
          value={autoSellCommon}
          onChange={setCommon}
          actionLabel={actionLabel}
        />
        <RaritySegment
          label={t("rareLabel")}
          value={autoSellRare}
          onChange={setRare}
          actionLabel={actionLabel}
        />
        <RaritySegment
          label={t("epicLabel")}
          value={autoSellEpic}
          onChange={setEpic}
          actionLabel={actionLabel}
        />
        <p className="text-[10px] text-ddp-ink-muted">{t("epicHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleKeepBetter}
          aria-pressed={autoSellKeepBetterStat}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold transition-all duration-100 active:scale-[0.97] ${
            autoSellKeepBetterStat
              ? "border-emerald-400 bg-emerald-400 text-emerald-950"
              : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              autoSellKeepBetterStat ? "bg-emerald-950" : "bg-ddp-ink-muted"
            }`}
          />
          {t("keepBetterStat")}
        </button>
      </div>
    </section>
  );
}
