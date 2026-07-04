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
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        ความเร็ว
      </span>
      <div className="flex gap-1 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-1 shadow-(--ddp-shadow-btn)">
        {CONFIG.speeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s as SpeedMultiplier)}
            aria-pressed={speed === s}
            className={`min-h-11 min-w-11 rounded-[calc(var(--ddp-radius-md)-0.25rem)] px-3 py-1.5 text-sm font-bold tabular-nums transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] ${
              speed === s
                ? "bg-emerald-400 text-emerald-950 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                : "bg-transparent text-ddp-ink-muted hover:text-ddp-ink"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
