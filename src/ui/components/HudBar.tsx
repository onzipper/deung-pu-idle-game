"use client";

/**
 * Top HUD strip: stage badge, gold, and the kill-goal progress bar toward
 * boss-readiness. Reads only the throttled snapshot fields it needs. (The wave
 * badge was retired with the M6 "สนามล่ามอน" combat rework — there are no waves.)
 *
 * Hierarchy (task 86d3k2tap, readability pass 86d3jv7m3): gold + zone-unlock
 * progress are the player's heartbeat — PRIMARY tier, biggest/boldest
 * numerals + tabular-nums + an icon, sized to read at a glance on a phone;
 * the stage recedes into a small chip badge (still >= 11px, never the
 * unreadable 8-10px micro-text the old pass shipped).
 */

import { useTranslations } from "next-intl";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { useGameStore } from "@/ui/store/gameStore";

export function HudBar() {
  const stage = useGameStore((s) => s.stage);
  const gold = useGameStore((s) => s.gold);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);
  const t = useTranslations("hud");

  const pct = killGoal > 0 ? Math.min(100, (kills / killGoal) * 100) : 0;
  const goldPulse = usePulseOnIncrease(gold);

  return (
    <div className="flex w-full flex-col gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-3 text-ddp-ink shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-baseline gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
            {t("stageLabel")}
          </span>
          <span className="text-lg font-bold text-emerald-300 tabular-nums">{stage}</span>
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/10 px-3 py-1.5">
          {/* CSS-drawn coin: the 🪙 emoji (Unicode 13) has no glyph on Windows 10 */}
          <span
            aria-hidden
            className="relative inline-block h-5 w-5 shrink-0 rounded-full border-2 border-amber-600 bg-amber-400 shadow-[inset_0_-2px_2px_rgba(0,0,0,0.25)]"
          >
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black leading-none text-amber-700">
              ฿
            </span>
          </span>
          <span
            className={`text-2xl font-extrabold text-ddp-gold tabular-nums ${goldPulse ? "animate-gold-pulse" : ""}`}
          >
            {gold.toLocaleString()}
          </span>
        </div>
      </div>
      <div data-onboarding-anchor="kill-progress" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-sm font-medium text-ddp-ink-muted">
          <span className="flex items-center gap-1.5">
            {/* 🔓 (Unicode 6.0) — Win10-safe, unlike newer emoji (footgun #4) */}
            <span aria-hidden>🔓</span> {t("zoneUnlockLabel")}
          </span>
          <span className="font-semibold text-ddp-ink tabular-nums">
            {kills} / {killGoal}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
