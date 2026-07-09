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
import { MaterialIcon } from "@/ui/components/icons";
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
      {/* M7.6 ตีบวก: refine-material counter, secondary to gold (smaller, cooler
          hue) so the hierarchy stays gold-first. */}
      <div className="flex items-center gap-1.5 rounded-(--ddp-radius-md) border border-violet-400/25 bg-violet-400/10 px-2.5 py-1.5">
        <MaterialIcon className="h-4 w-4" />
        <span
          className={`text-base font-bold text-violet-300 tabular-nums ${materialsPulse ? "animate-gold-pulse" : ""}`}
        >
          {materials.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
