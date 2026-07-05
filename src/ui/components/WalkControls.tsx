"use client";

/**
 * World navigation (M6 "World & Town"): the current map/zone label plus the two
 * walk arrows (◀ ▶). Tapping an arrow queues a `walkToZone` intent (drained once
 * per frame by GameClient); a locked neighbour is disabled with a reason tooltip.
 * The right arrow reads "เข้าห้องบอส" when the next zone is the map's boss room.
 *
 * Functional-only for M6 — theming + the goal-ladder polish are later tasks. The
 * boss-hint banner (BossPanel) and its challenge/next buttons still work alongside
 * this (they also resolve to walk intents in the engine).
 */

import { useTranslations } from "next-intl";
import { useGameStore, type NavNeighborSummary } from "@/ui/store/gameStore";

export function WalkControls() {
  const world = useGameStore((s) => s.world);
  const walkToZone = useGameStore((s) => s.walkToZone);
  const t = useTranslations("world");
  const tMaps = useTranslations("content.maps");

  const mapName = tMaps(`${world.mapId}.name`);
  const zoneLabel = world.traveling
    ? t("traveling")
    : world.kind === "town"
      ? t("zoneTown")
      : world.kind === "boss"
        ? t("zoneBoss")
        : t("zoneFarm", { stage: world.stage });

  return (
    <div className="flex items-center justify-between gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-2 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <WalkArrow
        dir="left"
        neighbor={world.left}
        traveling={world.traveling}
        onWalk={walkToZone}
      />
      <div className="flex min-w-0 flex-col items-center text-center">
        <span className="truncate text-sm font-bold text-emerald-300">{mapName}</span>
        <span className="text-[11px] font-medium text-ddp-ink-muted">{zoneLabel}</span>
      </div>
      <WalkArrow
        dir="right"
        neighbor={world.right}
        traveling={world.traveling}
        onWalk={walkToZone}
      />
    </div>
  );
}

function WalkArrow({
  dir,
  neighbor,
  traveling,
  onWalk,
}: {
  dir: "left" | "right";
  neighbor: NavNeighborSummary | null;
  traveling: boolean;
  onWalk: (target: { mapId: string; zoneIdx: number }) => void;
}) {
  const t = useTranslations("world");
  const glyph = dir === "left" ? "◀" : "▶";
  const isBossRoom = neighbor?.kind === "boss";
  const enabled = !!neighbor && neighbor.unlocked && !traveling;

  const label = !neighbor
    ? undefined
    : !neighbor.unlocked
      ? t("lockedTooltip")
      : isBossRoom
        ? t("enterBossRoom")
        : dir === "left"
          ? t("walkLeftAria")
          : t("walkRightAria");

  return (
    <button
      type="button"
      disabled={!enabled}
      title={label}
      aria-label={label}
      onClick={() => neighbor && onWalk({ mapId: neighbor.mapId, zoneIdx: neighbor.zoneIdx })}
      className={`relative flex min-h-11 min-w-11 items-center justify-center rounded-(--ddp-radius-md) border px-3 py-2 text-lg font-black shadow-(--ddp-shadow-btn) transition-all duration-100 ${
        enabled
          ? isBossRoom
            ? "border-ddp-boss bg-ddp-boss text-violet-950 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
            : "border-ddp-border-soft bg-black/30 text-ddp-ink hover:brightness-125 active:translate-y-0.5 active:scale-[0.97]"
          : "cursor-not-allowed border-ddp-border bg-black/20 text-ddp-ink-muted grayscale"
      }`}
    >
      <span aria-hidden>{glyph}</span>
      {neighbor && !neighbor.unlocked && (
        <span aria-hidden className="absolute -top-1 -right-1 text-[11px] leading-none">
          🔒
        </span>
      )}
      {isBossRoom && enabled && (
        <span aria-hidden className="absolute -top-1 -right-1 text-[11px] leading-none">
          ⚔
        </span>
      )}
    </button>
  );
}
