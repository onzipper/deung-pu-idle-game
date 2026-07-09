"use client";

/**
 * The "what do I do next" HUD element (M6 goal-ladder task, ROADMAP.md line
 * 32) — replaces `BossPanel.tsx` entirely (deleted).
 *
 * R2.6 Wave 1 "ref-style tabbed tracker" rewrite: the old always-visible
 * 4-rung breadcrumb is GONE (the Hall of Fame shortcut it carried lives in
 * the top-right icon menu row now — a documented duplicate entrance, same
 * pattern as `RungPill`'s old `hallOfFame` onClick used to be); the pure
 * `buildGoalLadder` rung-selection logic (`src/ui/goalLadder.ts`) still
 * drives BOTH the collapsed chip's icon/label AND which content renders
 * under the `[รอง]` tag below. The card is now a TabRow header
 * **[เควส | ปาร์ตี้]** over tag-grouped quest lines:
 *
 *  - `[หลัก]` — the current main-quest chapter line + its kill progress
 *    (mirrors `QuestBoardPanel.tsx`'s `MainQuestSection` math so the two
 *    surfaces never drift in wording; claiming still only happens at the
 *    Quest Board, read-only here).
 *  - `[รอง]` — the ORIGINAL `MilestoneCard` (levelUp progress / the full
 *    `ClassQuestCard` with its accept/guide/change-class buttons) plus the
 *    always-rendered `CoreLoopCard` (challenge-boss CTA / victory-next-stage
 *    / zone-unlock kill gauge) — BYTE-IDENTICAL behavior to before this
 *    rewrite, just re-tagged. `data-onboarding-anchor="boss-panel"` and the
 *    `kill-progress` anchors nested inside `CoreLoopCard` stay on the exact
 *    same elements so the FTUE keeps resolving them.
 *  - `[รายวัน]` — new read-only `DailyLines`, off `s.dailies` (claiming still
 *    only happens at the Quest Board — no claim button here, just a hint
 *    pointing there once complete-unclaimed). Omitted entirely when there's
 *    no daily roster.
 *
 * The `[เควส]` tab's content is `hidden`-classed but stays MOUNTED even while
 * `[ปาร์ตี้]` is active (same "FTUE anchors must always resolve" trick the
 * whole-card collapse below uses) — `PartyTrackerList.tsx` (party tab) may
 * unmount freely since nothing in it is FTUE-anchored.
 *
 * Collapse-to-chip (R2.6: now on ALL viewports, not just mobile) is driven by
 * the persisted `questTrackerCollapsed` store field (localStorage, same tier
 * as `ghostsVisible` — see `gameStore.ts`) rather than the old mobile-only
 * local `expandedMobile` state; `compact`/`expandedMobile` are GONE.
 * `GoalLadderOverlaySlot.tsx` no longer branches on viewport width at all.
 * The full content — including the `kill-progress`/`boss-panel` FTUE anchors
 * nested inside `CoreLoopCard` — is FORCE-expanded (and the tab FORCE-set to
 * `เควส`) whenever the FTUE sequence is actively running
 * (`onboardingStepIndex >= 0`), so the guided tour never spotlights a
 * collapsed/hidden target.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DailyObjectiveType } from "@/engine";
import { ASURA_MAP_ID, CONFIG, asuraRefineBandForStage } from "@/engine";
import { TabRow } from "@/ui/components/primitives/TabRow";
import { PartyTrackerList } from "@/ui/party/PartyTrackerList";
import {
  buildGoalLadder,
  selectZoneBossDetail,
  type GoalRungId,
} from "@/ui/goalLadder";
import { selectQuestGuideTarget } from "@/ui/questGuide";
import {
  readStoredQuestTrackerCollapsed,
  useGameStore,
  type HeroQuestSummary,
} from "@/ui/store/gameStore";

/** How long an armed (first-tap) class-change button stays armed before it
 * resets — matches the pre-move `ClassQuestAffordance` behavior in `SkillBar.tsx`. */
const EVOLVE_ARM_TIMEOUT_MS = 3000;

const RUNG_ICON: Record<GoalRungId, string> = {
  levelUp: "⭐",
  classQuest: "📜",
  zoneBoss: "⚔",
  hallOfFame: "🏆",
};

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
  // Tier-3 frontier GATE (owner rule 2026-07-07 "ห้ามข้ามแมพ") — read-only
  // engine derivations, same self-contained store-read pattern as `world`/
  // `unlockedZones` above. See `EngineSnapshot.tier3FrontierLocked`'s doc.
  const frontierLocked = useGameStore((s) => s.tier3FrontierLocked);
  const deepestFarm = useGameStore((s) => s.deepestUnlockedFarm);
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
  // Tier-3 frontier GATE override (owner rule 2026-07-07): while gated, the
  // kill row's location line ignores the normal scoped/unscoped copy — map4
  // z1 isn't actually walkable yet (kills stay 0 anyway, see module doc).
  const killHint = frontierLocked
    ? tq("guideKillGatedTier3")
    : quest.killMapId
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
    frontierLocked,
    deepestFarm,
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
    else if (guideTarget.kind === "gated") pushNotice("guideGatedTier3Frontier");
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
  const asuraZoneKills = useGameStore((s) => s.asuraZoneKills);
  const t = useTranslations("ladder");
  const tHud = useTranslations("hud");
  const tAsura = useTranslations("asura");

  const detail = selectZoneBossDetail(phase, bossReady);
  const inAsura = world.mapId === ASURA_MAP_ID;

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

  if (detail === "ready" && inAsura) {
    // ดินแดนอสูร s40 boss room (item 6): an intentional unbeatable wall in v1 —
    // no real numbers here, deliberately "???" so nobody grinds a wall they
    // can't see the shape of. The challenge button still functions (the wall
    // is real stat scaling, not an engine block) — just no encouragement.
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-red-300/90">{tAsura("bossMysteryHint")}</span>
        <button
          type="button"
          onClick={challengeBoss}
          aria-label={tHud("challengeBossAriaReady")}
          className="min-h-11 shrink-0 rounded-(--ddp-radius-md) border border-red-800/60 bg-red-950/40 px-5 py-2.5 text-sm font-extrabold text-red-200 shadow-(--ddp-shadow-btn) transition-all duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.97]"
        >
          ❓ {tHud("challengeBossButton")}
        </button>
      </div>
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
  // ดินแดนอสูร (item 3): a "which +N this zone wants" depth-band hint + (item 4)
  // a mysterious per-zone ศิลาโซน accrual hint — both inert outside asura.
  const asuraBand = inAsura && world.kind === "farm" ? asuraRefineBandForStage(world.stage) : null;
  const asuraZoneStoneCount = inAsura
    ? (asuraZoneKills[`${world.mapId}:${world.zoneIdx}`] ?? 0)
    : 0;
  return (
    <div className="flex flex-col gap-1.5">
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
      {asuraBand !== null && (
        <span className="text-[11px] font-semibold text-red-300/80">
          {tAsura("bandHint", { refine: asuraBand })}
        </span>
      )}
      {inAsura && world.kind === "farm" && (
        <span className="text-[11px] text-ddp-ink-muted/70">
          {tAsura("zoneStoneHint", {
            count: asuraZoneStoneCount,
            goal: CONFIG.asura.zoneStoneGoal,
          })}
        </span>
      )}
    </div>
  );
}

/** A gold bracket tag header (`[หลัก]`/`[รอง]`/`[รายวัน]`) sitting above one
 * group of quest lines — the ref-style grouping this Wave 1 rewrite adds. */
function TagHeader({ tag }: { tag: string }) {
  return (
    <span className="text-[10px] font-extrabold tracking-wide text-ddp-gold-bright uppercase">
      [{tag}]
    </span>
  );
}

/**
 * M8 quest Wave C — a compact "บทที่ N: ชื่อบท" line naming the current (first
 * not-yet-claimed) main-quest chapter, read-only (claiming happens ONLY at
 * ผู้ใหญ่บ้าน's Quest Board panel — town-only claim entry, design decision).
 * Reuses `questBoard.mainChapterLabel`/`mainProgress*`, the SAME templates
 * `QuestBoardPanel.tsx`'s `MainQuestSection` renders, so the two surfaces
 * never drift in wording (R2.6: now additionally mirrors that section's kill-
 * progress math — a thin bar while I'm standing in the objective's map).
 * Renders nothing once every chapter is claimed (nothing left to point at).
 */
function MainChapterLine() {
  const mainChapters = useGameStore((s) => s.mainChapters);
  const world = useGameStore((s) => s.world);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);
  const tBoard = useTranslations("questBoard");
  const tMain = useTranslations("quest.main");
  const tMaps = useTranslations("content.maps");
  const activeIdx = mainChapters.findIndex((c) => !c.claimed);
  if (activeIdx === -1) return null;
  const chapter = mainChapters[activeIdx];
  const here = world.mapId === chapter.mapId;
  const pct = here && killGoal > 0 ? Math.min(100, (kills / killGoal) * 100) : null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-ddp-ink-muted">
        {tBoard("mainChapterLabel", { n: activeIdx + 1, title: tMain(`${chapter.id}.title`) })}
      </span>
      {!chapter.complete && (
        <span className="text-[11px] font-semibold text-sky-200">
          {here
            ? tBoard("mainProgressHere", { kills, killGoal })
            : tBoard("mainProgressElsewhere", { map: tMaps(`${chapter.mapId}.name`) })}
        </span>
      )}
      {pct !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
          <div
            className="h-full rounded-full bg-ddp-gold transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Pre-2020, Win10-safe icons already shipped elsewhere (footgun #4) — same
 * map `QuestBoardPanel.tsx`'s `DAILY_ICON` uses, redeclared here (that one
 * isn't exported — same "small local const" idiom as `RUNG_ICON` above). */
const DAILY_ICON: Record<DailyObjectiveType, string> = {
  killAnywhere: "🗡",
  refineOnce: "⚒",
  buyPotions: "🧪",
  spendGold: "💰",
  clearAnyBoss: "👑",
};

/**
 * R2.6 Wave 1 `[รายวัน]` tag content — read-only rows off `s.dailies` (the
 * SAME roster `QuestBoardPanel.tsx`'s daily section renders). NO claim button
 * here by design (claiming stays a Quest Board / ผู้ใหญ่บ้าน-only action) — a
 * complete-unclaimed row instead shows a gold hint pointing there. Renders
 * nothing at all when there's no roster (fresh save / server not yet synced).
 */
function DailyLines() {
  const dailies = useGameStore((s) => s.dailies);
  const t = useTranslations("ladder");
  const tDaily = useTranslations("quest.daily");
  if (dailies.quests.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <TagHeader tag={t("tags.daily")} />
      {dailies.quests.map((quest) => {
        const pct = quest.target > 0 ? Math.min(100, (quest.progress / quest.target) * 100) : 0;
        const unclaimedComplete = quest.complete && !quest.claimed;
        return (
          <div
            key={quest.id}
            className={`flex flex-col gap-1 rounded-(--ddp-radius-md) border px-2.5 py-1.5 ${
              quest.claimed
                ? "border-ddp-border-soft bg-black/15 opacity-60"
                : unclaimedComplete
                  ? "border-ddp-gold/60 bg-ddp-gold/10"
                  : "border-ddp-border-soft bg-black/20"
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-ddp-ink-muted">
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden>{DAILY_ICON[quest.type]}</span>
                <span className={`truncate ${quest.claimed ? "" : "text-ddp-ink"}`}>
                  {tDaily(`${quest.id}.title`)}
                </span>
              </span>
              {quest.claimed ? (
                <span aria-hidden className="text-emerald-400">
                  ✓
                </span>
              ) : (
                <span className="tabular-nums">
                  {Math.min(quest.progress, quest.target)}/{quest.target}
                </span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  quest.complete ? "bg-emerald-400" : "bg-ddp-gold"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {unclaimedComplete && (
              <span className="text-[10px] font-semibold text-ddp-gold-bright">
                {t("dailyClaimHint")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type LadderTab = "quest" | "party";

export function GoalLadder() {
  const hero = useGameStore((s) => s.heroes[0]);
  const phase = useGameStore((s) => s.phase);
  const bossReady = useGameStore((s) => s.bossReady);
  const onboardingActive = useGameStore((s) => s.onboardingStepIndex >= 0);
  const questTrackerCollapsed = useGameStore((s) => s.questTrackerCollapsed);
  const toggleQuestTrackerCollapsed = useGameStore((s) => s.toggleQuestTrackerCollapsed);
  const setQuestTrackerCollapsed = useGameStore((s) => s.setQuestTrackerCollapsed);
  const [tab, setTab] = useState<LadderTab>("quest");
  const t = useTranslations("ladder");

  // Apply the persisted preference once, AFTER hydration — same idiom as
  // `GhostToggle.tsx`'s mount-only sync (reading localStorage during the
  // initial render would desync SSR/first-client render).
  useEffect(() => {
    setQuestTrackerCollapsed(readStoredQuestTrackerCollapsed());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  const { current, rungs } = buildGoalLadder({
    hero: hero
      ? {
          tier: hero.tier,
          quest: hero.quest
            ? { accepted: hero.quest.accepted, complete: hero.quest.complete }
            : null,
        }
      : null,
    phase,
    bossReady,
  });

  // FTUE must never spotlight a collapsed target, and never lands on the
  // party tab — see the module doc.
  const expanded = !questTrackerCollapsed || onboardingActive;
  const activeTab: LadderTab = onboardingActive ? "quest" : tab;
  const currentRung = rungs.find((r) => r.id === current) ?? rungs[0];

  return (
    <div
      data-onboarding-anchor="goal-ladder"
      className="flex flex-col gap-2.5 rounded-(--ddp-radius-lg) border border-ddp-boss/25 bg-ddp-panel px-4 py-3 shadow-(--ddp-shadow-panel)"
    >
      <button
        type="button"
        onClick={toggleQuestTrackerCollapsed}
        aria-expanded={expanded}
        aria-label={expanded ? t("collapseAria") : t("expandAria")}
        className="flex min-h-11 items-center justify-between gap-2"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold text-ddp-ink">
          {currentRung && <span aria-hidden>{RUNG_ICON[currentRung.id]}</span>}
          {currentRung ? t(`rungs.${currentRung.id}`) : ""}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-ddp-ink-muted transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      <div className={expanded ? "flex flex-col gap-2.5" : "hidden"}>
        <TabRow
          tabs={[
            { id: "quest", label: t("tabs.quest") },
            { id: "party", label: t("tabs.party") },
          ]}
          active={activeTab}
          onChange={setTab}
        />
        {/* [เควส] — stays MOUNTED (hidden-classed) even while [ปาร์ตี้] is
            active so the `goal-ladder`/`boss-panel`/`kill-progress` FTUE
            anchors nested inside always resolve, same trick the whole-card
            collapse above uses. */}
        <div className={activeTab === "quest" ? "flex flex-col gap-3" : "hidden"}>
          <div className="flex flex-col gap-1">
            <TagHeader tag={t("tags.main")} />
            <MainChapterLine />
          </div>
          <div className="flex flex-col gap-2">
            <TagHeader tag={t("tags.side")} />
            <MilestoneCard current={current} />
            <div data-onboarding-anchor="boss-panel">
              <CoreLoopCard />
            </div>
          </div>
          <DailyLines />
        </div>
        {/* [ปาร์ตี้] — presentational, nothing FTUE-anchored, free to unmount
            when inactive. */}
        {activeTab === "party" && <PartyTrackerList />}
      </div>
    </div>
  );
}
