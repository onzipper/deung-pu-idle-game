"use client";

/**
 * Top HUD strip: stage/wave badges, gold, and the kill-goal progress bar
 * toward boss-readiness. Reads only the throttled snapshot fields it needs.
 */

import { useGameStore } from "@/ui/store/gameStore";

export function HudBar() {
  const stage = useGameStore((s) => s.stage);
  const wave = useGameStore((s) => s.wave);
  const gold = useGameStore((s) => s.gold);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);

  const pct = killGoal > 0 ? Math.min(100, (kills / killGoal) * 100) : 0;

  return (
    <div className="flex w-full flex-col gap-1 rounded-xl bg-zinc-900/80 px-4 py-2 text-zinc-100">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-semibold">
          ด่าน <b className="text-emerald-400">{stage}</b>
        </span>
        <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-semibold">
          เวฟ <b className="text-emerald-400">{wave}</b>
        </span>
        <div className="flex-1" />
        <span className="text-xs text-zinc-400">ทอง</span>
        <span className="font-mono text-sm font-bold text-amber-400">
          {gold.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between text-[11px] text-zinc-400">
          <span>kill สู่บอส</span>
          <span>
            {kills} / {killGoal}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
