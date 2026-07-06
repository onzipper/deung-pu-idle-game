"use client";

/**
 * M7.5 "บอทผู้ช่วย" settings section — the idle-bot config form. `state.bot`
 * (SAVE v11) is ENGINE-persisted, unlike the UI-mirrored toggles elsewhere in
 * `SettingsPanel.tsx` (autoAllocate/autoReturn/auto-potion): every change here
 * queues the `setBotSettings` intent and reads the CURRENT values back off the
 * throttled snapshot (`HudState.bot`) rather than shadow-owning a local copy —
 * a stepper tap is applied by the engine, then reflected back within one
 * `CONFIG.uiSyncHz` tick (~100ms), same latency class as every other intent.
 */

import { useTranslations } from "next-intl";
import { CONFIG } from "@/engine";
import { useGameStore } from "@/ui/store/gameStore";

const TARGET_CAP = CONFIG.shop.stackCap;
const GOLD_STEP = 100;

function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold transition-all duration-100 active:scale-[0.97] ${
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

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max?: number;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-ddp-ink-muted/80">{label}</span>
      <div className="flex items-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          aria-label={`${label} -${step}`}
          className="min-h-11 w-9 text-base font-black text-ddp-ink-muted"
        >
          −
        </button>
        <span className="w-14 text-center text-xs font-bold tabular-nums text-ddp-ink">
          {value.toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          aria-label={`${label} +${step}`}
          className="min-h-11 w-9 text-base font-black text-ddp-ink-muted"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function BotSettingsSection() {
  const bot = useGameStore((s) => s.bot);
  const setBotSettings = useGameStore((s) => s.setBotSettings);
  const t = useTranslations("settings.bot");

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </h3>
      <p className="text-[11px] text-ddp-ink-muted/70">{t("hint")}</p>
      <div className="flex flex-wrap gap-2">
        <ToggleRow
          label={t("restockToggle")}
          on={bot.enabled}
          onToggle={() => setBotSettings({ enabled: !bot.enabled })}
        />
        <ToggleRow
          label={t("sellTripToggle")}
          on={bot.sellTripEnabled}
          onToggle={() => setBotSettings({ sellTripEnabled: !bot.sellTripEnabled })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Stepper
          label={t("hpTarget")}
          value={bot.hpPotionTarget}
          step={5}
          min={0}
          max={TARGET_CAP}
          onChange={(v) => setBotSettings({ hpPotionTarget: v })}
        />
        <Stepper
          label={t("mpTarget")}
          value={bot.mpPotionTarget}
          step={5}
          min={0}
          max={TARGET_CAP}
          onChange={(v) => setBotSettings({ mpPotionTarget: v })}
        />
        <Stepper
          label={t("scrollReserve")}
          value={bot.scrollReserve}
          step={1}
          min={0}
          max={TARGET_CAP}
          onChange={(v) => setBotSettings({ scrollReserve: v })}
        />
        <Stepper
          label={t("goldReserve")}
          value={bot.goldReserve}
          step={GOLD_STEP}
          min={0}
          onChange={(v) => setBotSettings({ goldReserve: v })}
        />
      </div>
      <p className="text-[10px] text-ddp-ink-muted/60">{t("goldReserveHint")}</p>
    </section>
  );
}
