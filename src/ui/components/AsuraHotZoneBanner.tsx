"use client";

/**
 * ดินแดนอสูร (ASURA) daily hot zone — a slim inline strip, same visual tier as
 * `WorldBossBanner.tsx`/`CohortStatus.tsx`. Renders NOTHING outside asura (the
 * overwhelming common case) or before the engine has resolved today's hot
 * zone (`asuraHotZoneIdx` starts `null`, set on the first `setAsuraHotZone`
 * intent GameClient queues while standing in asura — see its module doc).
 */

import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";
import { ASURA_MAP_ID } from "@/engine";

export function AsuraHotZoneBanner() {
  const t = useTranslations("asura");
  const world = useGameStore((s) => s.world);
  const hotZoneIdx = useGameStore((s) => s.asuraHotZoneIdx);

  if (world.mapId !== ASURA_MAP_ID || hotZoneIdx === null) return null;

  const here = world.kind === "farm" && world.zoneIdx === hotZoneIdx;
  const label = here ? t("hotZoneHere") : t("hotZoneElsewhere", { n: hotZoneIdx + 1 });
  const tone = here
    ? "border-amber-400/50 bg-amber-400/15 text-amber-200 animate-buy-pulse"
    : "border-red-800/40 bg-red-950/20 text-red-200";

  return (
    <div
      role="status"
      className={`w-full rounded-(--ddp-radius-md) border px-3 py-1.5 text-center text-[11px] font-bold ${tone}`}
    >
      🔥 {label}
    </div>
  );
}
