"use client";

/**
 * Top HUD strip: zone badge + warp button + gold. Reads only the throttled
 * snapshot fields it needs. (The wave badge was retired with the M6
 * "สนามล่ามอน" combat rework — there are no waves.)
 *
 * The zone-unlock kill-progress bar that used to live here moved into
 * `GoalLadder.tsx` (M6 goal-ladder task) — it's one of the ladder's rungs
 * now, integrated there rather than duplicated in both places (see that
 * component's doc comment; the `kill-progress` FTUE anchor moved with it).
 *
 * Owner UX round (2026-07-09): the warp/fast-travel button moved HERE, right
 * beside the zone label ("ปุ่มวาปย้ายไปอยู่ตรงบนซ้ายแถวๆ คำว่าโซน") — it used
 * to live in `WalkControls.tsx`'s bottom nav row; per the "warp = ONE place,
 * no satellites" house rule it's been REMOVED from there, not duplicated.
 *
 * Hierarchy (task 86d3k2tap, readability pass 86d3jv7m3): gold is the
 * player's heartbeat — PRIMARY tier, biggest/boldest numerals + tabular-nums
 * + an icon, sized to read at a glance on a phone; the stage recedes into a
 * small chip badge (still >= 11px, never the unreadable 8-10px micro-text the
 * old pass shipped).
 *
 * R1 W4: the stage chip is now a tappable button opening `WorldMapPanel` (the
 * "where is everything" surface — population/friends/party/hot-zone/boss
 * window). The 🌀 warp button stays exactly where it was, unchanged — "warp =
 * ONE place" per the house rule; the world map is a SEPARATE surface, not a
 * second warp menu.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FastTravelPicker } from "@/ui/components/FastTravelPicker";
import { Coin, MaterialIcon } from "@/ui/components/icons";
import { CurrencyChip } from "@/ui/components/primitives/CurrencyChip";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { useGameStore } from "@/ui/store/gameStore";
import { WorldMapPanel } from "@/ui/world/WorldMapPanel";

export function HudBar() {
  const stage = useGameStore((s) => s.stage);
  const gold = useGameStore((s) => s.gold);
  const materials = useGameStore((s) => s.materials);
  const worldTraveling = useGameStore((s) => s.world.traveling);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const [fastTravelOpen, setFastTravelOpen] = useState(false);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const t = useTranslations("hud");
  const tWorld = useTranslations("world");
  const tWorldMap = useTranslations("worldMap");

  const goldPulse = usePulseOnIncrease(gold);
  const materialsPulse = usePulseOnIncrease(materials);

  return (
    <div className="flex w-full items-center gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-3 text-ddp-ink shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setWorldMapOpen(true)}
        aria-label={tWorldMap("entryAria")}
        title={tWorldMap("entryAria")}
        className="flex min-h-11 items-baseline gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-1.5 transition-colors active:scale-95 hover:bg-black/40"
      >
        <span className="text-[11px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
          {t("stageLabel")}
        </span>
        <span className="text-lg font-bold text-emerald-300 tabular-nums">{stage}</span>
        <span aria-hidden className="text-[10px] text-ddp-ink-muted">
          ▸
        </span>
      </button>
      {worldMapOpen && <WorldMapPanel onClose={() => setWorldMapOpen(false)} />}
      <button
        type="button"
        disabled={worldTraveling || channeling}
        onClick={() => setFastTravelOpen(true)}
        title={tWorld("fastTravelButton")}
        aria-label={tWorld("fastTravelButton")}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border border-sky-400/50 bg-sky-400/10 text-lg text-sky-300 shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden>🌀</span>
      </button>
      {fastTravelOpen && <FastTravelPicker onClose={() => setFastTravelOpen(false)} />}
      <div className="flex-1" />
      {/* R2-W2: gold + material readouts migrated to the shared `CurrencyChip`
          primitive (was bespoke inline markup) — same gold-first > violet-
          secondary hierarchy, container-only pulse (never the digits), no
          digit tween per the primitive's own contract. */}
      <CurrencyChip
        icon={<Coin className="h-5 w-5" />}
        value={gold}
        pulse={goldPulse}
        variant="gold"
        ariaLabel={t("goldAria")}
      />
      <CurrencyChip
        icon={<MaterialIcon className="h-4 w-4" />}
        value={materials}
        pulse={materialsPulse}
        variant="violet"
        ariaLabel={t("materialsAria")}
      />
    </div>
  );
}
