/**
 * Pure selection logic for the HUD's "goal ladder" (M6 task, ROADMAP.md line
 * 32) — a single "what do I do next" element following the game's motivation
 * ladder: next level -> class-change quest (offered Lv.15) -> unlock the next
 * zone / beat the map boss room -> (M9) Hall of Fame. Kept engine/store-
 * decoupled (a plain narrow input shape, same pattern as
 * `onboarding/steps.ts`'s `OnboardingSnapshot`) so the rung-selection rule is
 * a headlessly-testable pure function — see `__tests__/goalLadder.test.ts`.
 *
 * `GoalLadder.tsx` renders TWO independent pieces off this module:
 *  - the BREADCRUMB (`buildGoalLadder().rungs`): all 4 rungs always visible,
 *    the current one highlighted, everything before it "done", everything
 *    after "upcoming" — `hallOfFame` is always a dimmed/LOCKED tail rung (M9
 *    doesn't exist yet, per the task brief).
 *  - the "core loop" card (`selectZoneBossDetail`) — the direct BossPanel
 *    replacement (challenge-boss CTA / victory-> next-stage / zone-unlock
 *    kill progress). This is driven PURELY by `phase`/`bossReady`, entirely
 *    independent of which narrative rung is "current": the challenge CTA and
 *    the zone-unlock kill bar must stay correct and visible from a fresh
 *    Lv.1 hero all the way through post-evolution farming (this is also what
 *    keeps the FTUE's `boss-panel`/`kill-progress` anchors resolvable no
 *    matter which milestone rung the hero is narratively on — see
 *    `GoalLadder.tsx`'s doc comment for the anchor-stability reasoning). An
 *    OPTIONAL milestone detail card (levelUp/classQuest progress) renders
 *    ADDITIONALLY, above the always-present core-loop card, only while one of
 *    those is the current rung (i.e. before the hero reaches tier 2).
 */

import type { Phase } from "@/engine";

export type GoalRungId = "levelUp" | "classQuest" | "zoneBoss" | "hallOfFame";

/** Fixed display order — matches the GDD/ROADMAP motivation ladder exactly. */
const RUNG_ORDER: readonly GoalRungId[] = [
  "levelUp",
  "classQuest",
  "zoneBoss",
  "hallOfFame",
];

export type GoalRungStatus = "done" | "current" | "upcoming" | "locked";

export interface GoalRungState {
  id: GoalRungId;
  status: GoalRungStatus;
}

/** Narrow, engine/store-decoupled hero view (structural subset of the store's
 * `HeroSummary`/`HeroQuestSummary` — no import needed here, same pattern as
 * `onboarding/steps.ts`'s `OnboardingHeroSnapshot`). Only the fields the
 * rung-selection rule actually needs. */
export interface GoalLadderHero {
  tier: 1 | 2;
  /** `null` below the quest's level gate (mirrors `HeroQuestSummary | null`);
   * otherwise present regardless of offered/accepted/complete — ANY non-null
   * quest means "the class-change milestone is now the active one". */
  quest: { complete: boolean } | null;
}

export interface GoalLadderInput {
  hero: GoalLadderHero | null;
  phase: Phase;
  bossReady: boolean;
}

/**
 * The single current-rung decision. `bossReady`/`victory` ALWAYS wins over
 * the hero's level/quest tier — the challenge/next-stage beat is the loop's
 * biggest moment and must surface regardless of narrative milestone (a fresh
 * Lv.3 hero clearing stage-1's boss is just as much "current rung: zoneBoss"
 * as a fully-evolved hero grinding stage 40). Otherwise: a tier-1 hero with
 * no quest yet offered is still grinding toward the Lv.15 gate (`levelUp`);
 * once a quest exists (offered, accepted, or complete-but-not-yet-evolved)
 * that becomes the current rung; a tier-2 (evolved) hero has nothing
 * narrative left but the endless zone/boss loop.
 */
export function selectCurrentRung(input: GoalLadderInput): GoalRungId {
  if (input.phase === "victory" || input.bossReady) return "zoneBoss";
  if (input.hero && input.hero.tier === 1) {
    return input.hero.quest ? "classQuest" : "levelUp";
  }
  return "zoneBoss";
}

/** Full breadcrumb: fixed 4-rung order, `hallOfFame` is always a locked tail
 * (M9 doesn't exist yet), the current rung highlighted, everything before it
 * in the fixed order marked "done", everything after "upcoming". */
export function buildGoalLadder(input: GoalLadderInput): {
  current: GoalRungId;
  rungs: GoalRungState[];
} {
  const current = selectCurrentRung(input);
  const currentIdx = RUNG_ORDER.indexOf(current);
  const rungs: GoalRungState[] = RUNG_ORDER.map((id, i) => ({
    id,
    status:
      id === "hallOfFame"
        ? "locked"
        : id === current
          ? "current"
          : i < currentIdx
            ? "done"
            : "upcoming",
  }));
  return { current, rungs };
}

/** The "core loop" card's sub-state (see module doc for why this is
 * independent of `selectCurrentRung`'s narrative rung). */
export type ZoneBossDetail = "victory" | "fighting" | "ready" | "farming";

export function selectZoneBossDetail(phase: Phase, bossReady: boolean): ZoneBossDetail {
  if (phase === "victory") return "victory";
  if (phase === "boss") return "fighting";
  return bossReady ? "ready" : "farming";
}
