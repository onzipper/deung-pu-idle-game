"use client";

/**
 * Boss hint (HP/ATK/recommended vs team power) + the challenge button, and
 * the victory -> next-stage button. Both actions are intents queued into the
 * store; the integration loop drains them into `FrameInput`.
 */

import { useGameStore } from "@/ui/store/gameStore";

export function BossPanel() {
  const phase = useGameStore((s) => s.phase);
  const bossReady = useGameStore((s) => s.bossReady);
  const bossHint = useGameStore((s) => s.bossHint);
  const challengeBoss = useGameStore((s) => s.challengeBoss);
  const advanceStage = useGameStore((s) => s.advanceStage);

  if (phase === "victory") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/60 bg-emerald-950/60 px-4 py-3">
        <span className="text-sm font-semibold text-emerald-300">
          🎉 ชนะด่าน {bossHint.stage}!
        </span>
        <button
          type="button"
          onClick={advanceStage}
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:brightness-110"
        >
          ด่านถัดไป →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-900/80 px-4 py-2">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-zinc-400">
        <span>
          HP บอส <b className="font-mono text-zinc-200">{bossHint.bossHp.toLocaleString()}</b>
        </span>
        <span>
          พลังโจมตี <b className="font-mono text-zinc-200">{bossHint.bossAtk}</b>
        </span>
        <span>
          พลังทีมแนะนำ{" "}
          <b className="font-mono text-zinc-200">{bossHint.recommendedPower}</b>
        </span>
        <span>
          พลังทีมคุณ <b className="font-mono text-zinc-200">{bossHint.teamPower}</b>
        </span>
        <span className={bossHint.ready ? "text-emerald-400" : "text-amber-400"}>
          {bossHint.ready ? "✅ พร้อมสู้" : "⚠ พลังอาจไม่พอ"}
        </span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        disabled={!bossReady || phase !== "battle"}
        onClick={challengeBoss}
        className="rounded-lg bg-violet-400 px-4 py-2 text-sm font-bold text-violet-950 shadow-[0_0_18px_rgba(139,127,240,0.4)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        ⚔ ท้าบอส
      </button>
    </div>
  );
}
