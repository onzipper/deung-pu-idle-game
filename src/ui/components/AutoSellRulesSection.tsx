"use client";

/**
 * M7.5 auto-sell rules — the sell-trip bot's rarity toggles + keep-guard.
 * localStorage-persisted UI preference (`readStoredAutoSellRules`'s doc,
 * `gameStore.ts`), same tier as `soundMuted`: the rules THEMSELVES aren't
 * game progress, only the bot's own `state.bot` config is engine-persisted.
 * Epic is v1 owner-locked OFF — no toggle exists for it (not just disabled).
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { readStoredAutoSellRules, useGameStore } from "@/ui/store/gameStore";

function RuleToggle({
  label,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold transition-all duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "border-emerald-400 bg-emerald-400 text-emerald-950"
          : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-950" : "bg-ddp-ink-muted"}`}
      />
      {label}
    </button>
  );
}

export function AutoSellRulesSection() {
  const autoSellCommon = useGameStore((s) => s.autoSellCommon);
  const autoSellRare = useGameStore((s) => s.autoSellRare);
  const autoSellKeepBetterStat = useGameStore((s) => s.autoSellKeepBetterStat);
  const toggleCommon = useGameStore((s) => s.toggleAutoSellCommon);
  const toggleRare = useGameStore((s) => s.toggleAutoSellRare);
  const toggleKeepBetter = useGameStore((s) => s.toggleAutoSellKeepBetterStat);
  const hydrate = useGameStore((s) => s.hydrateAutoSellRules);
  const t = useTranslations("settings.autoSell");

  // Apply the persisted rules once, AFTER hydration — same "don't read
  // localStorage during the initial render" rule as `SoundToggle.tsx`.
  useEffect(() => {
    hydrate(readStoredAutoSellRules());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </h3>
      <div className="flex flex-wrap gap-2">
        <RuleToggle label={t("sellCommon")} on={autoSellCommon} onToggle={toggleCommon} />
        <RuleToggle label={t("sellRare")} on={autoSellRare} onToggle={toggleRare} />
        <RuleToggle label={t("sellEpic")} on={false} onToggle={() => {}} disabled />
        <RuleToggle
          label={t("keepBetterStat")}
          on={autoSellKeepBetterStat}
          onToggle={toggleKeepBetter}
        />
      </div>
    </section>
  );
}
