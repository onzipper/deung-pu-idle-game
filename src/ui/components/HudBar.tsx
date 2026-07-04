"use client";

/**
 * Top HUD strip: stage/wave badges, gold, and the kill-goal progress bar
 * toward boss-readiness. Reads only the throttled snapshot fields it needs.
 *
 * Hierarchy (task 86d3k2tap): gold + kill-progress are the player's
 * heartbeat, so they get the biggest/boldest numerals + tabular-nums + an
 * icon; stage/wave recede into small chip badges.
 */

import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { useGameStore } from "@/ui/store/gameStore";

export function HudBar() {
  const stage = useGameStore((s) => s.stage);
  const wave = useGameStore((s) => s.wave);
  const gold = useGameStore((s) => s.gold);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);

  const pct = killGoal > 0 ? Math.min(100, (kills / killGoal) * 100) : 0;
  const goldPulse = usePulseOnIncrease(gold);

  return (
    <div className="flex w-full flex-col gap-2 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-4 py-3 text-ddp-ink shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-baseline gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-1">
          <span className="text-[10px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
            ด่าน
          </span>
          <span className="text-base font-bold text-emerald-300 tabular-nums">{stage}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-1">
          <span className="text-[10px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
            เวฟ
          </span>
          <span className="text-base font-bold text-ddp-ink tabular-nums">{wave}</span>
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/10 px-2.5 py-1">
          <span className="text-base leading-none" aria-hidden>
            🪙
          </span>
          <span
            className={`text-xl font-extrabold text-ddp-gold tabular-nums ${goldPulse ? "animate-gold-pulse" : ""}`}
          >
            {gold.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px] font-medium text-ddp-ink-muted">
          <span className="flex items-center gap-1">
            <span aria-hidden>💀</span> kill สู่บอส
          </span>
          <span className="tabular-nums">
            {kills} / {killGoal}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
