"use client";

/**
 * World navigation (M6 "World & Town"; R1 W2 "tappable gates" removed the
 * walk arrows): the current map/zone label + the bot master switch. Zone-to-
 * zone travel is now driven by TAPPING the gate structures rendered in the
 * game world itself (owner: "อยากให้เป็นการคลิกที่ตัวเกม เช่นการคลิกที่
 * ประตู") — see `GameRenderer.hitTestGate()` / `GameClient.tsx`'s
 * `onGateTap()` / `@/ui/world/gateTap.ts`'s `resolveGateTap()`, which fires
 * the EXACT SAME `walkToZone` intent this row's old ◀ ▶ `WalkArrow` buttons
 * used to queue (removed here, not duplicated).
 *
 * Owner UX round (2026-07-09): the warp/fast-travel button that used to live in
 * this row moved to `HudBar.tsx` (beside the top-left zone label) — "warp = ONE
 * place, no satellites" (house rule), so it's gone from here, not duplicated.
 *
 * The goal-ladder's core-loop card (`GoalLadder.tsx`, replaced `BossPanel`)
 * and its challenge/next-stage buttons still work alongside this (they also
 * resolve to walk intents in the engine).
 */

import { useTranslations } from "next-intl";
import { ASURA_MAP_ID } from "@/engine";
import { FastTravelChannelBar } from "@/ui/components/FastTravelChannelBar";
import { BotMasterSwitch } from "@/ui/components/BotMasterSwitch";
import { CancelCommandChip } from "@/ui/components/CancelCommandChip";
import { useGameStore } from "@/ui/store/gameStore";

export function WalkControls() {
  const world = useGameStore((s) => s.world);
  const phase = useGameStore((s) => s.phase);
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-2 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm">
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
