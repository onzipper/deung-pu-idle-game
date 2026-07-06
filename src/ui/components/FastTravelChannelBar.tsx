"use client";

/**
 * M7.5 Fast Travel — the channel progress indicator. Store-driven off
 * `fastTravelChannel` (set on `fastTravelCastStart`, cleared on arrival/block —
 * see `GameClient.tsx`'s frame-event handling), NOT a per-frame countdown: the
 * fill is a plain CSS width sweep whose duration is the engine's own
 * `CONFIG.travel.fastTravelCastSeconds` (same "one throttled/event value drives
 * a CSS animation" vocabulary as the skill cooldown sweep). `key={channel.key}`
 * forces the animation to restart on every NEW channel.
 */

import { useTranslations } from "next-intl";
import { CONFIG } from "@/engine";
import { useGameStore } from "@/ui/store/gameStore";

export function FastTravelChannelBar() {
  const channel = useGameStore((s) => s.fastTravelChannel);
  const t = useTranslations("world");
  const tMaps = useTranslations("content.maps");

  if (!channel) return null;

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-sky-400/50 bg-black/40 px-2.5 py-1.5">
      <span aria-hidden className="text-sm">
        🌀
      </span>
      <span className="shrink-0 text-xs font-bold text-sky-300">
        {t("fastTravelChanneling", { map: tMaps(`${channel.mapId}.name`) })}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/50">
        <div
          key={channel.key}
          className="animate-fasttravel-fill h-full bg-sky-400"
          style={{ animationDuration: `${CONFIG.travel.fastTravelCastSeconds}s` }}
        />
      </div>
    </div>
  );
}
