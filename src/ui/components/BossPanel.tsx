"use client";

/**
 * Boss hint (HP/ATK/recommended vs team power) + the challenge button, and
 * the victory -> next-stage button. Both actions are intents queued into the
 * store; the integration loop drains them into `FrameInput`.
 *
 * Styled as its own "encounter gate" banner (violet, matching the boss's
 * in-canvas accent — PALETTE.boss in src/render/theme.ts) rather than folded
 * into the generic dock, since challenging the boss is the loop's biggest
 * beat (kill -> gold -> upgrade -> power spike -> boss).
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
      <div className="flex items-center justify-between gap-3 rounded-(--ddp-radius-lg) border border-emerald-400/50 bg-emerald-950/60 px-4 py-3 shadow-(--ddp-shadow-panel)">
        <span className="text-sm font-bold text-emerald-300">
          🎉 ชนะด่าน {bossHint.stage}!
        </span>
        <button
          type="button"
          onClick={advanceStage}
          className="min-h-11 rounded-(--ddp-radius-md) bg-emerald-400 px-5 py-2.5 text-sm font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-transform duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
        >
          ด่านถัดไป →
        </button>
      </div>
    );
  }

  const canChallenge = bossReady && phase === "battle";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-(--ddp-radius-lg) border border-ddp-boss/25 bg-ddp-panel px-4 py-3 shadow-(--ddp-shadow-panel)">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ddp-ink-muted">
        <span>
          HP บอส{" "}
          <b className="font-bold text-ddp-ink tabular-nums">
            {bossHint.bossHp.toLocaleString()}
          </b>
        </span>
        <span>
          พลังโจมตี <b className="font-bold text-ddp-ink tabular-nums">{bossHint.bossAtk}</b>
        </span>
        <span>
          พลังทีมแนะนำ{" "}
          <b className="font-bold text-ddp-ink tabular-nums">{bossHint.recommendedPower}</b>
        </span>
        <span>
          พลังทีมคุณ{" "}
          <b className="font-bold text-ddp-ink tabular-nums">{bossHint.teamPower}</b>
        </span>
        <span
          className={
            bossHint.ready
              ? "font-semibold text-emerald-400"
              : "font-semibold text-amber-400"
          }
        >
          {bossHint.ready ? "✅ พร้อมสู้" : "⚠ พลังอาจไม่พอ"}
        </span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        disabled={!canChallenge}
        onClick={challengeBoss}
        aria-label={
          canChallenge ? "ท้าบอส" : "ท้าบอส (ยังท้าไม่ได้ตอนนี้)"
        }
        className={`relative min-h-11 rounded-(--ddp-radius-md) border px-5 py-2.5 text-sm font-extrabold shadow-(--ddp-shadow-btn) transition-all duration-100 ${
          canChallenge
            ? "border-ddp-boss bg-ddp-boss text-violet-950 before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_22px_4px_rgba(139,127,240,0.55)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.4s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
            : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted grayscale"
        }`}
      >
        ⚔ ท้าบอส
      </button>
    </div>
  );
}
