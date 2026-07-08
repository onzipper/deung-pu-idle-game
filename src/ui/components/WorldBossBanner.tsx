"use client";

/**
 * World boss "เสี่ยจ๋อง" (hourly world boss) — the countdown/found-it banner.
 * Presentational only: the schedule math lives in `GameClient.tsx` (drives
 * `ui/worldBoss/schedule.ts`'s pure helpers off the server-clock-aligned
 * `worldBossPhaseAt`), which pushes the display-ready `worldBossStatus` field
 * into the store on TRANSITIONS only (never per-frame — same idiom as
 * `cohortStatus`). Renders NOTHING for `"idle"` (the overwhelming common case
 * — the boss window is closed most of the hour). Same visual tier as
 * `UpdateBanner`/`CohortStatus`: a slim inline strip in the HUD flow.
 */

import { useTranslations } from "next-intl";
import { formatCountdown } from "@/ui/worldBoss/schedule";
import { useGameStore } from "@/ui/store/gameStore";

export function WorldBossBanner() {
  const t = useTranslations("worldBoss");
  const status = useGameStore((s) => s.worldBossStatus);

  if (status.kind === "idle") return null;

  const time = formatCountdown(status.secondsLeft);
  const label =
    status.kind === "pre"
      ? t("pre", { time })
      : status.kind === "activeHere"
        ? t("activeHere")
        : t("active", { time });

  const tone =
    status.kind === "activeHere"
      ? "border-rose-400/50 bg-rose-400/15 text-rose-200 animate-buy-pulse"
      : "border-ddp-gold/40 bg-ddp-gold/10 text-ddp-gold-bright";

  return (
    <div
      role="status"
      className={`w-full rounded-(--ddp-radius-md) border px-3 py-1.5 text-center text-[11px] font-bold ${tone}`}
    >
      {label}
    </div>
  );
}
