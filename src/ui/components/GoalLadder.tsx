"use client";

/**
 * The "what do I do next" HUD element (M6 goal-ladder task, ROADMAP.md line
 * 32) — replaces `BossPanel.tsx` entirely (deleted). Two independently-driven
 * pieces (see `src/ui/goalLadder.ts` for the pure selection logic + why
 * they're split this way):
 *
 *  - a BREADCRUMB of all 4 motivation-ladder rungs (next level -> class-
 *    change quest -> unlock next zone / beat the map boss -> Hall of Fame),
 *    current one bright, earlier ones checked "done", later ones dim, and
 *    `hallOfFame` ALWAYS a dimmed/locked tail (M9 doesn't exist yet).
 *  - the "core loop" card — the direct BossPanel replacement (challenge-boss
 *    CTA / victory -> next-stage / zone-unlock kill progress). This is driven
 *    PURELY by `phase`/`bossReady`, independent of the breadcrumb's current
 *    rung, so the challenge CTA (the loop's biggest beat) and the
 *    `hud.zoneUnlockLabel` kill bar (integrated here, no longer duplicated in
 *    `HudBar.tsx`) stay correct and visible from a fresh Lv.1 hero all the
 *    way through post-evolution farming — this is also what keeps BOTH FTUE
 *    anchors (`boss-panel`, `kill-progress`) resolvable no matter which
 *    narrative rung is current. An OPTIONAL milestone card (levelUp/
 *    classQuest progress) renders additionally, ABOVE the always-present core
 *    loop card, only while one of those is the current rung (i.e. before the
 *    hero evolves to tier 2) — the interactive accept/change-class controls
 *    themselves stay in `SkillBar.tsx` (`ClassQuestAffordance`); this card is
 *    read-only progress, not a second copy of that control.
 *
 * The `boss-panel` data-onboarding-anchor moves here (was on `BossPanel`'s
 * two branches) onto the always-rendered core-loop card, so the FTUE
 * `bossChallenge` step keeps resolving it exactly like before.
 */

import { useTranslations } from "next-intl";
import { CONFIG } from "@/engine";
import {
  buildGoalLadder,
  selectZoneBossDetail,
  type GoalRungId,
  type GoalRungState,
} from "@/ui/goalLadder";
import { useGameStore } from "@/ui/store/gameStore";

const RUNG_ICON: Record<GoalRungId, string> = {
  levelUp: "⭐",
  classQuest: "📜",
  zoneBoss: "⚔",
  hallOfFame: "🏆",
};

function RungPill({ rung }: { rung: GoalRungState }) {
  const t = useTranslations("ladder");
  const label = t(`rungs.${rung.id}`);
  const icon = rung.status === "done" ? "✓" : RUNG_ICON[rung.id];

  const styles =
    rung.status === "current"
      ? "border-ddp-boss/60 bg-ddp-boss/15 text-ddp-ink"
      : rung.status === "done"
        ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300/80"
        : rung.status === "locked"
          ? "border-ddp-border-soft bg-black/20 text-ddp-ink-muted/50 grayscale"
          : "border-ddp-border-soft bg-black/20 text-ddp-ink-muted/70";

  return (
    <span
      title={rung.status === "locked" ? t("hallOfFameHint") : label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold whitespace-nowrap ${styles}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

/** Optional milestone detail card — only rendered while `levelUp`/`classQuest`
 * is the current rung (see module doc). Read-only progress; the actual
 * accept/change-class buttons live in `SkillBar.tsx`. */
function MilestoneCard({ current }: { current: GoalRungId }) {
  const hero = useGameStore((s) => s.heroes[0]);
  const t = useTranslations("ladder");
  const tq = useTranslations("panels.classQuest");
  if (!hero || (current !== "levelUp" && current !== "classQuest")) return null;

  if (current === "levelUp") {
    const pct = Math.max(0, Math.min(1, hero.xpProgress)) * 100;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[13px] text-ddp-ink-muted">
          <span>
            {t("levelUp.progress", {
              level: hero.level,
              gate: CONFIG.evolution.levelRequired,
            })}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
          <div
            className="h-full rounded-full bg-ddp-gold transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  const quest = hero.quest;
  if (!quest) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-[13px] text-ddp-ink-muted">
      <span>
        {quest.complete
          ? t("classQuest.readyHint")
          : tq("progress", {
              kills: quest.kills,
              goal: quest.killGoal,
              boss: quest.bossDone ? "✓" : "✗",
            })}
      </span>
    </div>
  );
}

/** The always-rendered core-loop card — the direct `BossPanel` replacement. */
function CoreLoopCard() {
  const phase = useGameStore((s) => s.phase);
  const bossReady = useGameStore((s) => s.bossReady);
  const bossHint = useGameStore((s) => s.bossHint);
  const challengeBoss = useGameStore((s) => s.challengeBoss);
  const advanceStage = useGameStore((s) => s.advanceStage);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);
  const world = useGameStore((s) => s.world);
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const t = useTranslations("ladder");
  const tHud = useTranslations("hud");

  const detail = selectZoneBossDetail(phase, bossReady);

  if (detail === "victory") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-emerald-300">
          {tHud("victoryTitle", { stage: bossHint.stage })}
        </span>
        <button
          type="button"
          onClick={advanceStage}
          className="min-h-11 rounded-(--ddp-radius-md) bg-emerald-400 px-5 py-2.5 text-sm font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-transform duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
        >
          {tHud("nextStageButton")}
        </button>
      </div>
    );
  }

  if (detail === "fighting") {
    return (
      <span className="text-sm font-semibold text-ddp-ink-muted">
        {t("zoneBoss.fightingHint")}
      </span>
    );
  }

  if (detail === "ready") {
    // Recommended-vs-your-power comparison, now a single glanceable ratio bar
    // instead of four raw numbers (fixes the old bossHp-only toLocaleString
    // inconsistency too — every number below is consistently formatted).
    // Display-capped: post-M7.7 skill power can dwarf the per-stage
    // recommendation — "999%+" reads as "overwhelming", an uncapped 4-digit
    // percent reads as a rendering bug.
    const rawPct =
      bossHint.recommendedPower > 0
        ? Math.round((bossHint.teamPower / bossHint.recommendedPower) * 100)
        : 100;
    const pct = Math.min(999, rawPct);
    const barPct = Math.min(100, pct);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-semibold text-ddp-ink-muted">
              {t("zoneBoss.readyHint")}
            </span>
            <span
              className={`font-bold tabular-nums ${bossHint.ready ? "text-emerald-400" : "text-amber-400"}`}
            >
              {t("powerRatioLabel", { pct })}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${bossHint.ready ? "bg-emerald-400" : "bg-amber-400"}`}
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="text-[11px] text-ddp-ink-muted/80 tabular-nums">
            {t("bossStatsLabel", {
              hp: bossHint.bossHp.toLocaleString(),
              atk: bossHint.bossAtk.toLocaleString(),
            })}
          </span>
        </div>
        <button
          type="button"
          onClick={challengeBoss}
          aria-label={tHud("challengeBossAriaReady")}
          className="relative min-h-11 shrink-0 rounded-(--ddp-radius-md) border border-ddp-boss bg-ddp-boss px-5 py-2.5 text-sm font-extrabold text-violet-950 shadow-(--ddp-shadow-btn) transition-all duration-100 before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_22px_4px_rgba(139,127,240,0.55)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.4s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
        >
          {tHud("challengeBossButton")}
        </button>
      </div>
    );
  }

  // "farming": context-aware (2026-07-07 fix — the quota bar used to render
  // in TOWN with a meaningless 0/N, and in already-cleared zones as if they
  // needed unlocking again):
  //  - town → a rest hint, no quota bar (nothing to unlock from town);
  //  - a farm zone whose NEXT zone is already unlocked → free-farm hint.
  if (world.kind === "town") {
    return (
      <span
        data-onboarding-anchor="kill-progress"
        className="text-sm font-medium text-ddp-ink-muted"
      >
        {t("zoneBoss.townHint")}
      </span>
    );
  }
  const nextUnlocked = world.zoneIdx + 1 < (unlockedZones[world.mapId] ?? 0);
  if (nextUnlocked) {
    return (
      <span
        data-onboarding-anchor="kill-progress"
        className="text-sm font-medium text-ddp-ink-muted"
      >
        {t("zoneBoss.freeFarmHint")}
      </span>
    );
  }
  const pct = killGoal > 0 ? Math.min(100, (kills / killGoal) * 100) : 0;
  return (
    <div data-onboarding-anchor="kill-progress" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm font-medium text-ddp-ink-muted">
        <span className="flex items-center gap-1.5">
          {/* 🔓 (Unicode 6.0) — Win10-safe, unlike newer emoji (footgun #4) */}
          <span aria-hidden>🔓</span> {tHud("zoneUnlockLabel")}
        </span>
        <span className="font-semibold text-ddp-ink tabular-nums">
          {kills} / {killGoal}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
        <div
          className="h-full rounded-full bg-emerald-400 transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function GoalLadder() {
  const hero = useGameStore((s) => s.heroes[0]);
  const phase = useGameStore((s) => s.phase);
  const bossReady = useGameStore((s) => s.bossReady);

  const { current, rungs } = buildGoalLadder({
    hero: hero
      ? { tier: hero.tier, quest: hero.quest ? { complete: hero.quest.complete } : null }
      : null,
    phase,
    bossReady,
  });

  return (
    <div className="flex flex-col gap-2.5 rounded-(--ddp-radius-lg) border border-ddp-boss/25 bg-ddp-panel px-4 py-3 shadow-(--ddp-shadow-panel)">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {rungs.map((rung) => (
          <RungPill key={rung.id} rung={rung} />
        ))}
      </div>
      <MilestoneCard current={current} />
      <div data-onboarding-anchor="boss-panel">
        <CoreLoopCard />
      </div>
    </div>
  );
}
