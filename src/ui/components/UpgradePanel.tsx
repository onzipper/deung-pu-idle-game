"use client";

/**
 * Three independent upgrade lines (atk / speed / hp) + an auto-buy toggle.
 * Buying is an intent — `buyUpgrade(stat)` only queues it; the integration
 * loop drains the queue into `FrameInput.buyUpgrade` for the engine to apply.
 */

import { SPEED_UPGRADE_CAP, type Upgrades } from "@/engine";
import { UPGRADE_LABELS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const STATS: (keyof Upgrades)[] = ["atk", "speed", "hp"];

function UpgradeButton({ stat }: { stat: keyof Upgrades }) {
  const level = useGameStore((s) => s.upgrades[stat]);
  const cost = useGameStore((s) => s.upgradeCosts[stat]);
  const gold = useGameStore((s) => s.gold);
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);

  const capped = stat === "speed" && level >= SPEED_UPGRADE_CAP;
  const affordable = gold >= cost && !capped;
  const label = UPGRADE_LABELS[stat];

  return (
    <button
      type="button"
      disabled={!affordable}
      onClick={() => buyUpgrade(stat)}
      className="flex min-w-24 flex-1 flex-col items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 transition enabled:hover:border-emerald-400 enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-xs font-semibold">
        {label.icon} {label.name}
      </span>
      <span className="text-[10px] text-zinc-400">Lv.{level}</span>
      <span className="font-mono text-[11px] text-amber-400">
        {capped ? "MAX" : cost.toLocaleString()}
      </span>
    </button>
  );
}

export function UpgradePanel() {
  const autoUpgrade = useGameStore((s) => s.autoUpgrade);
  const toggleAutoUpgrade = useGameStore((s) => s.toggleAutoUpgrade);

  return (
    <div className="flex flex-wrap items-stretch gap-2 rounded-xl bg-zinc-900/80 px-3 py-2">
      {STATS.map((stat) => (
        <UpgradeButton key={stat} stat={stat} />
      ))}
      <button
        type="button"
        onClick={toggleAutoUpgrade}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          autoUpgrade
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "border-zinc-700 bg-zinc-800 text-zinc-400"
        }`}
      >
        💰 Auto อัป: {autoUpgrade ? "เปิด" : "ปิด"}
      </button>
    </div>
  );
}
