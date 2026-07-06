"use client";

/**
 * M7 Gear & Drops — drop-feed toast juice. Store-driven off `dropFeed`
 * (pushed only for a freshly-minted claim result — see `gameStore.ts`'s
 * `pushDropFeed` doc), NOT off raw `itemDrop` engine events directly (those
 * are buffered/claimed server-side first; the toast fires once the mint is
 * confirmed, same "one-way, read-only" shape the render fx layer uses for
 * engine events). Epic gets a stronger visual beat (brighter border + the ✨
 * marker from `RARITY_COLORS`) — same fixed/viewport-anchored z-layer
 * vocabulary as `OnboardingOverlay`/`ContextualTipOverlay`.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { RARITY_COLORS } from "@/ui/labels";
import { useGameStore, type DropFeedEntry } from "@/ui/store/gameStore";

/** Wall-clock display duration per toast — epic lingers a beat longer. */
function displayMs(entry: DropFeedEntry): number {
  return entry.rarity === "epic" ? 5000 : 3500;
}

function DropToast({ entry }: { entry: DropFeedEntry }) {
  const dismiss = useGameStore((s) => s.dismissDropFeed);
  const t = useTranslations("dropFeed");
  const tContent = useTranslations("content.items");
  const colors = RARITY_COLORS[entry.rarity];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(entry.id), displayMs(entry));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry`/`dismiss` are stable per mount
  }, []);

  const name = tContent(`${entry.templateId}.name`);

  return (
    <div
      className={`animate-buy-pulse pointer-events-none flex items-center gap-1.5 rounded-(--ddp-radius-md) border ${colors.border} bg-black/80 px-3 py-1.5 text-xs font-bold ${colors.text} shadow-(--ddp-shadow-btn)`}
    >
      {colors.icon && <span aria-hidden>{colors.icon}</span>}
      {t("gotItem", { name })}
    </div>
  );
}

export function DropFeed() {
  const dropFeed = useGameStore((s) => s.dropFeed);
  if (dropFeed.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {dropFeed.map((entry) => (
        <DropToast key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
