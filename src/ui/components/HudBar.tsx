"use client";

/**
 * Top HUD strip: stage badge + gold. Reads only the throttled snapshot fields
 * it needs. (The wave badge was retired with the M6 "สนามล่ามอน" combat
 * rework — there are no waves.)
 *
 * The zone-unlock kill-progress bar that used to live here moved into
 * `GoalLadder.tsx` (M6 goal-ladder task) — it's one of the ladder's rungs
 * now, integrated there rather than duplicated in both places (see that
 * component's doc comment; the `kill-progress` FTUE anchor moved with it).
 *
 * Hierarchy (task 86d3k2tap, readability pass 86d3jv7m3): gold is the
 * player's heartbeat — PRIMARY tier, biggest/boldest numerals + tabular-nums
 * + an icon, sized to read at a glance on a phone; the stage recedes into a
 * small chip badge (still >= 11px, never the unreadable 8-10px micro-text the
 * old pass shipped).
 */

import { useTranslations } from "next-intl";
import { MaterialIcon } from "@/ui/components/icons";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { useGameStore } from "@/ui/store/gameStore";

export function HudBar() {
  const stage = useGameStore((s) => s.stage);
  const gold = useGameStore((s) => s.gold);
  const materials = useGameStore((s) => s.materials);
  const t = useTranslations("hud");

  const goldPulse = usePulseOnIncrease(gold);
  const materialsPulse = usePulseOnIncrease(materials);

  return (
    <div className="flex w-full items-center gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-3 text-ddp-ink shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <span className="inline-flex items-baseline gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
          {t("stageLabel")}
        </span>
        <span className="text-lg font-bold text-emerald-300 tabular-nums">{stage}</span>
      </span>
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
