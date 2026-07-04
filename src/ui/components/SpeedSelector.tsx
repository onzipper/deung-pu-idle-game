"use client";

/**
 * 1x/2x/3x speed toggle. Plain UI state (`store.speed`) — the integration
 * loop reads it directly each frame to decide how many fixed sub-steps to
 * drain (never a bigger `dt`), so there is no intent-queue entry for this.
 */

import { CONFIG, type SpeedMultiplier } from "@/engine";
import { useGameStore } from "@/ui/store/gameStore";

export function SpeedSelector() {
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);

  return (
    <div className="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-1">
      {CONFIG.speeds.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSpeed(s as SpeedMultiplier)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            speed === s
              ? "bg-emerald-400 text-emerald-950"
              : "bg-transparent text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}
