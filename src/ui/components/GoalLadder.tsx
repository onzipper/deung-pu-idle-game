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
 *    narrative rung is current. An OPTIONAL milestone card (levelUp progress /
 *    the FULL `ClassQuestCard`) renders additionally, ABOVE the always-present
 *    core loop card, only while one of those is the current rung (i.e. before
 *    the hero evolves to tier 2) — `ClassQuestCard` is the ONE place the
 *    class-change quest's accept/guide/change-class controls live (UX-fix
 *    wave, audit #1: moved off `SkillBar.tsx`'s old `ClassQuestAffordance`,
 *    which is gone entirely).
 *
 * The `boss-panel` data-onboarding-anchor moves here (was on `BossPanel`'s
 * two branches) onto the always-rendered core-loop card, so the FTUE
 * `bossChallenge` step keeps resolving it exactly like before.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CONFIG } from "@/engine";
import { HallOfFamePanel } from "@/ui/hof/HallOfFamePanel";
import {
  buildGoalLadder,
  selectZoneBossDetail,
  type GoalRungId,
  type GoalRungState,
} from "@/ui/goalLadder";
import { selectQuestGuideTarget } from "@/ui/questGuide";
import { useGameStore, type HeroQuestSummary } from "@/ui/store/gameStore";

/** How long an armed (first-tap) class-change button stays armed before it
 * resets — matches the pre-move `ClassQuestAffordance` behavior in `SkillBar.tsx`. */
const EVOLVE_ARM_TIMEOUT_MS = 3000;

const RUNG_ICON: Record<GoalRungId, string> = {
  levelUp: "⭐",
  classQuest: "📜",
  zoneBoss: "⚔",
  hallOfFame: "🏆",
};

/** The `hallOfFame` rung (M7.95): the breadcrumb tail is still narratively
 * "locked" (dimmed styling — no season/end-game rung exists yet, see
 * `goalLadder.ts`'s doc), but it's now a REAL clickable shortcut into the
 * `HallOfFamePanel` leaderboard viewer rather than a pure teaser — `onClick`
 * is only ever passed for this one rung id (`GoalLadder`'s render below). */
function RungPill({ rung, onClick }: { rung: GoalRungState; onClick?: () => void }) {
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
  const title = rung.status === "locked" ? t("hallOfFameHint") : label;

  // The Hall of Fame rung is ALWAYS clickable (a real shortcut into the
  // leaderboard viewer, `onClick` only ever passed for this one rung id —
  // see the module doc) even though its narrative `status` reads "locked"
  // (M9 doesn't exist yet). A live shortcut must never read as
  // grayscale/disabled (audit #2/#8, owner-reported "สีเหมือนกดไม่ได้") — give
  // it the SAME gold-accent language as `HallOfFameButton.tsx` so both
  // entrances into the same panel read as one consistent affordance.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-ddp-gold/50 bg-ddp-gold/10 px-2 py-1 text-[10px] font-bold whitespace-nowrap text-ddp-gold-bright transition-all duration-100 hover:border-ddp-gold hover:bg-ddp-gold/20 active:scale-95"
      >
        <span aria-hidden>🏆</span>
        {label}
      </button>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold whitespace-nowrap ${styles}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

/** One objective ROW of the full quest card (owner-approved quest UX
 * upgrade): icon + label + its own progress bar (kill objectives, goal > 1)
 * or a WORDED done/pending chip (boss objectives, goal 1 — owner item #9: a
 * lone ✓/✗ glyph "communicates nothing", so the complete/incomplete state is
 * spelled out — "Defeated ✓" / "Not yet" — with the checkmark kept only as a
 * decoration NEXT TO the word) — plus, only while incomplete, a plain-words
 * location line underneath, and an optional `action` node (M7.9b: the boss
 * row's "⚔ ท้าบอส" challenge button) rendered last. Generalizes over both
 * objective types purely off `goal` so it never needs to know which one it's
 * rendering. */
function QuestObjectiveRow({
  icon,
  label,
  progress,
  goal,
  done,
  locationHint,
  action,
}: {
  icon: string;
  label: string;
  progress: number;
  goal: number;
  done: boolean;
  locationHint: string | null;
  action?: ReactNode;
}) {
  const t = useTranslations("ladder.classQuest");
  const pct = goal > 0 ? Math.min(100, (progress / goal) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-ddp-ink-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden>{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span
          className={`shrink-0 font-bold tabular-nums whitespace-nowrap ${
            done ? "text-emerald-400" : goal > 1 ? "text-ddp-ink" : "text-amber-400"
          }`}
        >
          {goal > 1
            ? `${Math.min(progress, goal)}/${goal}`
            : done
              ? t("bossStatusDone")
              : t("bossStatusPending")}
        </span>
      </div>
      {goal > 1 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${done ? "bg-emerald-400" : "bg-ddp-gold"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {!done && locationHint && (
        <span className="text-[11px] text-ddp-ink-muted/80">{locationHint}</span>
      )}
      {!done && action}
    </div>
  );
}

/** The full quest card — the ONE place the class-change quest lives (audit
 * #1, owner-reported: the accept-quest + change-class buttons, including the
 * tap-again-confirm flow, moved HERE from `SkillBar.tsx`'s old
 * `ClassQuestAffordance` — that component and its "skill bar" chips are gone
 * entirely). Renders a PRE-ACCEPT preview (full objectives + reward + the
 * accept button) while offered, or the per-objective progress +
 * location-guidance + "พาไปเลย" (Guide me) button while accepted-incomplete,
 * or the 2-tap-confirm "เปลี่ยนคลาส!" button once complete. Reads the
 * hero/world state itself (same self-contained pattern as `CoreLoopCard`). */
function ClassQuestCard({
  quest,
  tier,
  cls,
  dead,
}: {
  quest: HeroQuestSummary;
  tier: 1 | 2 | 3;
  cls: string;
  dead: boolean;
}) {
  const t = useTranslations("ladder");
  const tq = useTranslations("panels.classQuest");
  const tContent = useTranslations("content");
  const queueFastTravel = useGameStore((s) => s.queueFastTravel);
  const pushNotice = useGameStore((s) => s.pushNotice);
  const world = useGameStore((s) => s.world);
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const challengeBoss = useGameStore((s) => s.challengeBoss);
  const acceptQuest = useGameStore((s) => s.acceptQuest);
  const evolveHero = useGameStore((s) => s.evolveHero);
  // Solo gameplay: the goal ladder always drives hero slot 0 (same convention
  // as `StatPanel`/`SkillBar` reading `heroes[0]`) — party slots are M8+.
  const slot = 0;
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  function disarm(): void {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
  }

  function handleChangeClass(): void {
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), EVOLVE_ARM_TIMEOUT_MS);
      return;
    }
    disarm();
    evolveHero(slot);
  }

  // Shared disabled-reason chain for the location/combat-gated buttons below
  // (challenge/guide) — same "compute a reason, title explains it" pattern as
  // `RefinePanel.tsx`'s `disabledReason` (audit #4). Priority: dead first
  // (nothing else matters if the hero is down), then channeling/traveling.
  const actionDisabledReason: "dead" | "channeling" | "traveling" | null = dead
    ? "dead"
    : channeling
      ? "channeling"
      : world.traveling
        ? "traveling"
        : null;

  // "{map name} (แมพ N)" — matches the codex's "บอสประจำ<map>" naming voice
  // while still surfacing the numbered map players already navigate by.
  const mapLabel = (mapId: string) =>
    `${tContent(`maps.${mapId}.name`)} (${t("mapNumberLabel", { n: mapId.replace(/^map/, "") })})`;

  const killDone = quest.kills >= quest.killGoal;
  const killLabel = quest.killMapId
    ? tq("objectiveKillScoped", { map: mapLabel(quest.killMapId) })
    : tq("objectiveKillAny");
  // M7.9b: the tier-3 quest's boss objective is scoped to the SAME map as its
  // kill objective (both pin to `CONFIG.quest.tier3.killMapId`, "map4" today —
  // see `engine/systems/quests.tier3QuestFor`); the tier-1 class-change quest
  // never scopes both, so this structural check identifies ONLY the young
  // Glacial Sovereign quest without hardcoding a map id. Gives it flavor copy
  // + the challenge-affordance treatment instead of the generic "{map} boss".
  const isTier3BossQuest =
    quest.bossMapId !== null &&
    quest.bossMapId === quest.killMapId &&
    quest.bossMapId === CONFIG.quest.tier3.killMapId;
  const bossLabel = isTier3BossQuest
    ? tq("objectiveBossYoungSovereign")
    : quest.bossMapId
      ? tq("objectiveBossScoped", { map: mapLabel(quest.bossMapId) })
      : tq("objectiveBossAny");

  // "backtrack" hint (M7.9 tier-3 quest): the boss objective's map differs
  // from where the hero is currently standing — explain WHY (re-fight an
  // earlier map's boss) rather than just saying "go there".
  const isBacktrack = quest.bossMapId !== null && quest.bossMapId !== world.mapId;
  const killHint = quest.killMapId
    ? tq("guideKillScoped", { map: mapLabel(quest.killMapId) })
    : tq("guideKillAny");
  const bossGuideHint = isTier3BossQuest
    ? tq("guideBossTier3Hint")
    : isBacktrack
      ? tq("guideBossBacktrack", { map: mapLabel(quest.bossMapId as string) })
      : tq("guideBossAny");

  const heroName = tContent(`classes.${cls}.${tier === 2 ? "evolvedName" : "name"}`);
  const nextClassName = tContent(
    `classes.${cls}.${tier === 1 ? "evolvedName" : "tier3Name"}`,
  );
  const rewardLine =
    tier === 1
      ? tq("rewardLine", { cls: nextClassName })
      : tq("rewardLineTier3", { cls: nextClassName });

  // Pre-accept: full preview + the "รับเควส" accept button (moved here from
  // `SkillBar.tsx` — audit #1). Not location-gated (accepting doesn't require
  // travel), only guarded on the hero being alive.
  if (quest.offered) {
    return (
      <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-2.5">
        <span className="text-[12px] font-bold text-ddp-ink">
          {tq("cardTitlePreAccept")}
        </span>
        <QuestObjectiveRow
          icon="🗡"
          label={killLabel}
          progress={0}
          goal={quest.killGoal}
          done={false}
          locationHint={null}
        />
        <QuestObjectiveRow
          icon="👑"
          label={bossLabel}
          progress={0}
          goal={1}
          done={false}
          locationHint={null}
        />
        <span className="text-[11px] font-semibold text-ddp-gold-bright">
          {rewardLine}
        </span>
        <button
          type="button"
          disabled={dead}
          onClick={() => acceptQuest(slot)}
          title={dead ? tq("disabled.dead") : undefined}
          aria-label={tq("ariaAccept", { heroName })}
          className="min-h-11 w-full rounded-(--ddp-radius-md) border border-ddp-gold/50 bg-ddp-gold/10 px-3 text-[12px] font-bold text-ddp-gold-bright transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-ddp-border disabled:bg-black/25 disabled:text-ddp-ink-muted"
        >
          {tq("acceptButton")}
        </button>
      </div>
    );
  }

  const guideTarget = selectQuestGuideTarget({
    kill: { mapId: quest.killMapId, done: killDone },
    boss: { mapId: quest.bossMapId, done: quest.bossDone },
    currentMapId: world.mapId,
    unlockedZones,
  });
  // Priority: the shared dead/channeling/traveling chain first (audit #4 —
  // "disabled reasons matching RefinePanel's pattern"), then the guide-
  // specific "nowhere left to send you" edge case (no textual reason needed —
  // it only happens once both objectives are already done-but-not-yet-synced).
  const guideDisabledReason = actionDisabledReason ?? (!guideTarget ? "noTarget" : null);
  const guideDisabled = guideDisabledReason !== null;

  const handleGuide = () => {
    if (!guideTarget) return;
    queueFastTravel({ mapId: guideTarget.zone.mapId, zoneIdx: guideTarget.zone.zoneIdx });
    if (guideTarget.kind === "boss") pushNotice("guideBossDoor");
    else if (guideTarget.kind === "bossTier3") pushNotice("guideBossTier3");
  };

  // M7.9b challenge affordance: queues the SAME `challengeBoss` intent as the
  // regular boss rung (`CoreLoopCard`) — the engine's `enterBossRoom` picks
  // this quest-boss path over the normal one whenever
  // `isTier3BossObjectiveActive` is true, so there's no separate mutator to
  // wire. `bossChallengeActive` is location-independent by design (engine
  // doc); this button only additionally guards the usual one-shot-action
  // states (traveling/channeling/dead) — if tapped from outside the granted
  // frontier zone the engine safely no-ops (never crosstalks with the
  // regular `bossReady` boss-gate rung, which arms off a totally different
  // read).
  const challengeDisabled = actionDisabledReason !== null;

  return (
    <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-2.5">
      <QuestObjectiveRow
        icon="🗡"
        label={killLabel}
        progress={quest.kills}
        goal={quest.killGoal}
        done={killDone}
        locationHint={killDone ? null : killHint}
      />
      <QuestObjectiveRow
        icon="👑"
        label={bossLabel}
        progress={quest.bossDone ? 1 : 0}
        goal={1}
        done={quest.bossDone}
        locationHint={quest.bossDone ? null : bossGuideHint}
        action={
          quest.bossChallengeActive ? (
            <button
              type="button"
              disabled={challengeDisabled}
              onClick={challengeBoss}
              title={actionDisabledReason ? tq(`disabled.${actionDisabledReason}`) : undefined}
              aria-label={tq("ariaChallenge", { heroName })}
              className="min-h-11 w-full rounded-(--ddp-radius-md) border border-ddp-boss/50 bg-ddp-boss/15 px-3 text-[12px] font-bold text-ddp-ink transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-ddp-border disabled:bg-black/25 disabled:text-ddp-ink-muted"
            >
              ⚔ {tq("challengeButton")}
            </button>
          ) : undefined
        }
      />
      <span
        className={`text-[11px] font-semibold ${quest.complete ? "text-emerald-300" : "text-ddp-gold-bright"}`}
      >
        {quest.complete ? t("classQuest.readyHint") : rewardLine}
      </span>
      {!quest.complete && (
        <button
          type="button"
          disabled={guideDisabled}
          onClick={handleGuide}
          title={
            guideDisabledReason && guideDisabledReason !== "noTarget"
              ? tq(`disabled.${guideDisabledReason}`)
              : undefined
          }
          aria-label={tq("ariaGuide", { heroName })}
          className="min-h-11 w-full rounded-(--ddp-radius-md) border border-sky-400/50 bg-sky-400/10 px-3 text-[12px] font-bold text-sky-200 transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-ddp-border disabled:bg-black/25 disabled:text-ddp-ink-muted"
        >
          🧭 {tq("guideButton")}
        </button>
      )}
      {/* Complete: the class-change button (2-tap confirm — moved here from
          `SkillBar.tsx`'s old `ClassQuestAffordance`, audit #1). */}
      {quest.complete && (
        <button
          type="button"
          disabled={dead}
          onClick={handleChangeClass}
          onBlur={disarm}
          title={
            armed ? tq("confirmHint") : dead ? tq("disabled.dead") : undefined
          }
          aria-label={tq("ariaChange", { heroName, state: armed ? "confirm" : "normal" })}
          className={`min-h-11 w-full rounded-(--ddp-radius-md) border px-3 text-[12px] font-bold transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-ddp-border disabled:bg-black/25 disabled:text-ddp-ink-muted ${
            armed
              ? "animate-buy-pulse border-ddp-gold bg-ddp-gold text-ddp-panel-strong"
              : "border-ddp-gold/50 bg-ddp-gold/10 text-ddp-gold-bright"
          }`}
        >
          {armed ? tq("confirmLabel") : tq("changeButton")}
        </button>
      )}
    </div>
  );
}

/** Optional milestone detail card — only rendered while `levelUp`/`classQuest`
 * is the current rung (see module doc). Read-only progress for `levelUp`;
 * `ClassQuestCard` (below) owns the FULL class-quest experience, including
 * its own accept/guide/change-class controls. */
function MilestoneCard({ current }: { current: GoalRungId }) {
  const hero = useGameStore((s) => s.heroes[0]);
  const t = useTranslations("ladder");
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
  return <ClassQuestCard quest={quest} tier={hero.tier} cls={hero.cls} dead={hero.dead} />;
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
  const [hofOpen, setHofOpen] = useState(false);

  const { current, rungs } = buildGoalLadder({
    hero: hero
      ? { tier: hero.tier, quest: hero.quest ? { complete: hero.quest.complete } : null }
      : null,
    phase,
    bossReady,
  });

  return (
    <div
      data-onboarding-anchor="goal-ladder"
      className="flex flex-col gap-2.5 rounded-(--ddp-radius-lg) border border-ddp-boss/25 bg-ddp-panel px-4 py-3 shadow-(--ddp-shadow-panel)"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {rungs.map((rung) => (
          <RungPill
            key={rung.id}
            rung={rung}
            onClick={rung.id === "hallOfFame" ? () => setHofOpen(true) : undefined}
          />
        ))}
      </div>
      <MilestoneCard current={current} />
      <div data-onboarding-anchor="boss-panel">
        <CoreLoopCard />
      </div>
      {hofOpen && <HallOfFamePanel onClose={() => setHofOpen(false)} />}
    </div>
  );
}
