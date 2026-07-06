"use client";

/**
 * World navigation (M6 "World & Town"): the current map/zone label plus the two
 * walk arrows (◀ ▶). Tapping an arrow queues a `walkToZone` intent (drained once
 * per frame by GameClient); a locked neighbour is disabled with a reason tooltip.
 * The right arrow reads "เข้าห้องบอส" when the next zone is the map's boss room.
 *
 * Functional-only for M6 — theming polish is a later task. The goal-ladder's
 * core-loop card (`GoalLadder.tsx`, replaced `BossPanel`) and its challenge/
 * next-stage buttons still work alongside this (they also resolve to walk
 * intents in the engine).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FastTravelChannelBar } from "@/ui/components/FastTravelChannelBar";
import { AutoHuntToggle } from "@/ui/components/AutoHuntToggle";
import { CancelCommandChip } from "@/ui/components/CancelCommandChip";
import { FastTravelPicker } from "@/ui/components/FastTravelPicker";
import { useGameStore, type NavNeighborSummary } from "@/ui/store/gameStore";

export function WalkControls() {
  const world = useGameStore((s) => s.world);
  const phase = useGameStore((s) => s.phase);
  const walkToZone = useGameStore((s) => s.walkToZone);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const [fastTravelOpen, setFastTravelOpen] = useState(false);
  const t = useTranslations("world");
  const tMaps = useTranslations("content.maps");

  const mapName = tMaps(`${world.mapId}.name`);
  // Frontier: cleared the last map's boss room and there's no further map yet
  // (map4 is M7+ content) — a graceful "end of the frontier" state (walk left to
  // keep farming), not a stall.
  const atFrontier = phase === "victory" && world.right === null;
  const zoneLabel = world.traveling
    ? t("traveling")
    : atFrontier
      ? t("frontier")
      : world.kind === "town"
        ? t("zoneTown")
        : world.kind === "boss"
          ? t("zoneBoss")
          : t("zoneFarm", { stage: world.stage });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-2 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm">
        <WalkArrow
          dir="left"
          neighbor={world.left}
          traveling={world.traveling}
          onWalk={walkToZone}
        />
        <div className="flex min-w-0 flex-col items-center text-center">
          <span className="truncate text-base font-bold text-emerald-300">{mapName}</span>
          <span className="text-xs font-medium text-ddp-ink-muted">{zoneLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AutoHuntToggle />
          <button
            type="button"
            disabled={world.traveling || channeling}
            onClick={() => setFastTravelOpen(true)}
            title={t("fastTravelButton")}
            aria-label={t("fastTravelButton")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-(--ddp-radius-md) border border-sky-400/50 bg-sky-400/10 text-lg text-sky-300 shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden>🌀</span>
          </button>
          <WalkArrow
            dir="right"
            neighbor={world.right}
            traveling={world.traveling}
            onWalk={walkToZone}
          />
        </div>
      </div>
      {/* M7.8 Manual Play: only rendered while the hero has an active
          move/attack command — see `CancelCommandChip`'s own doc. */}
      <div className="flex justify-center">
        <CancelCommandChip />
      </div>
      <FastTravelChannelBar />
      {fastTravelOpen && <FastTravelPicker onClose={() => setFastTravelOpen(false)} />}
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
      onClick={() =>
        neighbor && onWalk({ mapId: neighbor.mapId, zoneIdx: neighbor.zoneIdx })
      }
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
