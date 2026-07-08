"use client";

/**
 * World navigation (M6 "World & Town"): the current map/zone label plus the two
 * walk arrows (◀ ▶). Tapping an arrow queues a `walkToZone` intent (drained once
 * per frame by GameClient); a locked neighbour is disabled with a reason tooltip.
 * The right arrow reads "เข้าห้องบอส" when the next zone is the map's boss room.
 *
 * Owner UX round (2026-07-09): the warp/fast-travel button that used to live in
 * this row moved to `HudBar.tsx` (beside the top-left zone label) — "warp = ONE
 * place, no satellites" (house rule), so it's gone from here, not duplicated.
 *
 * Functional-only for M6 — theming polish is a later task. The goal-ladder's
 * core-loop card (`GoalLadder.tsx`, replaced `BossPanel`) and its challenge/
 * next-stage buttons still work alongside this (they also resolve to walk
 * intents in the engine).
 */

import { useTranslations } from "next-intl";
import { ASURA_MAP_ID } from "@/engine";
import { FastTravelChannelBar } from "@/ui/components/FastTravelChannelBar";
import { BotMasterSwitch } from "@/ui/components/BotMasterSwitch";
import { CancelCommandChip } from "@/ui/components/CancelCommandChip";
import { useGameStore, type NavNeighborSummary } from "@/ui/store/gameStore";

export function WalkControls() {
  const world = useGameStore((s) => s.world);
  const phase = useGameStore((s) => s.phase);
  const walkToZone = useGameStore((s) => s.walkToZone);
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
          ? // ดินแดนอสูร s40 boss room: an intentional unbeatable wall in v1 —
            // labeled "???" so players don't waste time trying to grind it (item 6).
            world.mapId === ASURA_MAP_ID
            ? t("asuraBossMystery")
            : t("zoneBoss")
          : t("zoneFarm", { stage: world.stage });

  return (
    <div className="flex flex-col gap-2">
      {/* Structural overflow guard (audit #7): `flex-wrap` is the FALLBACK —
          at a comfortable width every child fits on one line as before, but
          at a narrow logical width (~320px) the fixed-size clusters (nav
          arrows, bot switch + right arrow) never squish or overlap; instead
          the row wraps onto a second line while the center label truncates
          to whatever space it's given. The warp button moved to `HudBar.tsx`
          (owner UX round 2026-07-09), which loosened this row's own width
          arithmetic — a real in-browser check is still recommended. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-2 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm">
        <WalkArrow
          dir="left"
          neighbor={world.left}
          traveling={world.traveling}
          onWalk={walkToZone}
        />
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <span className="w-full truncate text-base font-bold text-emerald-300">
            {mapName}
          </span>
          <span className="w-full truncate text-xs font-medium text-ddp-ink-muted">
            {zoneLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <BotMasterSwitch />
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

  const isAsuraBossRoom = isBossRoom && neighbor?.mapId === ASURA_MAP_ID;
  const label = !neighbor
    ? undefined
    : !neighbor.unlocked
      ? t("lockedTooltip")
      : isAsuraBossRoom
        ? t("asuraBossMystery")
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
      className={`relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border px-3 py-2 text-lg font-black shadow-(--ddp-shadow-btn) transition-all duration-100 ${
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
