/**
 * Pure selection logic for the HUD's "goal ladder" (M6 task, ROADMAP.md line
 * 32) — a single "what do I do next" element following the game's motivation
 * ladder: next level -> class-change quest (offered Lv.15) -> unlock the next
 * zone / beat the map boss room -> (M9) Hall of Fame. Kept engine/store-
 * decoupled (a plain narrow input shape, same pattern as
 * `onboarding/steps.ts`'s `OnboardingSnapshot`) so the rung-selection rule is
 * a headlessly-testable pure function — see `__tests__/goalLadder.test.ts`.
 *
 * `GoalLadder.tsx` renders TWO independent pieces off this module (R2.6 Wave 1:
 * the old always-visible 4-rung BREADCRUMB UI is gone — see that file's doc —
 * but `buildGoalLadder().rungs`' `current` id still drives the collapsed
 * chip's icon/label, and `hallOfFame`'s own panel entrance moved to the
 * top-right icon menu row):
 *  - `current` (`buildGoalLadder().current`): which rung is narratively
 *    active right now — `hallOfFame` is the terminal id once every earlier
 *    rung is "done" (M9 doesn't exist yet, per the task brief).
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

// M8 quest Wave A handoff ("goalLadder ui->engine re-export flagged for Wave
// C"): re-export the MAIN-quest chapter derivation from the engine so new UI
// code (the goal card's chapter line, the Quest Board panel) has ONE import
// path for both this module's rung logic and the chapter defs, instead of a
// second `@/engine` import line. Purely additive (no existing export
// touched) — existing call sites are untouched, so this doesn't churn any
// tests.
export { mainChapterDefs, type MainChapterDef } from "@/engine";

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
  tier: 1 | 2 | 3;
  /** `null` below the quest's level gate (mirrors `HeroQuestSummary | null`);
   * otherwise present regardless of offered/accepted/complete — ANY non-null
   * quest means "the class-change milestone is now the active one" for the
   * BREADCRUMB's rung (`buildGoalLadder`). `accepted` additionally gates
   * `selectCurrentRung`'s priority-#1 behavior (2026-07-07 owner report,
   * see its doc) — an OFFERED-but-not-yet-accepted quest deliberately does
   * NOT outrank the zoneBoss "ready" state, only an accepted one does. */
  quest: { accepted: boolean; complete: boolean } | null;
}

export interface GoalLadderInput {
  hero: GoalLadderHero | null;
  phase: Phase;
  bossReady: boolean;
}

/**
 * The single current-rung decision.
 *
 * Precedence (2026-07-07 owner report fix — an ACCEPTED evolution quest used
 * to get buried behind an unrelated zone boss becoming challengeable):
 *  1. `phase === "victory"` or `"boss"` (actually fighting) ALWAYS wins over
 *     everything else — the biggest in-the-moment beat, and the hero mid-
 *     fight needs fight feedback regardless of any quest state.
 *  2. An ACCEPTED evolution quest (in progress OR complete-but-not-yet-
 *     consumed change-class) is priority #1 over the zoneBoss "ready" state
 *     — quest guidance must not be hidden just because some OTHER zone's
 *     boss door happens to be open. An OFFERED-but-not-yet-accepted quest
 *     deliberately does NOT get this priority: players who haven't engaged
 *     the offer yet keep the pre-existing behavior (boss guidance still
 *     wins) rather than being forced to notice a quest they ignored.
 *  3. Otherwise: `bossReady` wins (the original "challenge/next-stage beat
 *     surfaces regardless of narrative milestone" rule — a fresh Lv.3 hero
 *     clearing stage-1's boss is just as much "current rung: zoneBoss" as a
 *     fully-evolved hero grinding stage 40).
 *  4. A tier-1 hero with no quest yet offered is still grinding toward the
 *     Lv.15 gate (`levelUp`, the ONLY tier that reaches this rung —
 *     `MilestoneCard` hardcodes the tier-1 level gate for its progress bar,
 *     see `GoalLadder.tsx`); once EITHER evolution quest exists (tier-1's
 *     class-change OR the M7.9 tier-2 -> tier-3 quest — offered, accepted,
 *     or complete-but-not-yet-evolved) that becomes the current rung
 *     regardless of which tier it belongs to (same `classQuest` rung
 *     id/copy serves both, `evolutionQuestFor` already resolves the right
 *     def per tier); a tier-2 hero with NO active quest yet (still grinding
 *     toward the Lv.40 gate) and a fully-evolved tier-3 hero both fall
 *     through to the endless zone/boss loop.
 */
export function selectCurrentRung(input: GoalLadderInput): GoalRungId {
  if (input.phase === "victory" || input.phase === "boss") return "zoneBoss";
  if (input.hero && input.hero.tier < 3 && input.hero.quest?.accepted) {
    return "classQuest";
  }
  if (input.bossReady) return "zoneBoss";
  if (input.hero && input.hero.tier < 3) {
    if (input.hero.quest) return "classQuest";
    if (input.hero.tier === 1) return "levelUp";
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
