/**
 * Onboarding/FTUE step registry — the DATA-DRIVEN core of the framework.
 *
 * Pure TS (no React/DOM), so the trigger/advance/gating logic below is
 * headlessly testable (`__tests__/steps.test.ts`) exactly like `engine/`,
 * even though this file lives in `ui/` (it just happens to have zero
 * framework dependencies, not because of an enforced boundary).
 *
 * FUTURE MILESTONES (contextual tutorial hooks, guide/codex, mascot) add new
 * behaviour by APPENDING entries to `ONBOARDING_STEPS` (+ matching
 * `messages/*.json` "onboarding.steps.<id>" keys) and, if a new advance
 * condition is needed, a new `OnboardingActionKind`/predicate — nothing else
 * in this file's shape should need to change. See `src/ui/README.md`.
 */

import type { Phase } from "@/engine";
import type { MascotMood } from "@/ui/onboarding/mascotMood";

/** Narrow, engine-decoupled view of the throttled HUD snapshot — just the
 * fields any onboarding trigger/advance predicate might need. Deliberately
 * NOT `EngineSnapshot` itself so this module has zero store/engine coupling.
 *
 * Also the SHARED snapshot type for the contextual-tips registry (`./tips.ts`).
 * M5 Character Pivot: the upgrade lines are gone, so `upgrades`/`upgradeCosts`/
 * `autoUpgrade` were dropped from this shape (a fuller FTUE/codex rework is a
 * later M5 task). */
export interface OnboardingSnapshot {
  gold: number;
  stage: number;
  kills: number;
  phase: Phase;
  autoCast: boolean;
  heroes: { skillCd: number; dead: boolean }[];
}

/** Builds the shared snapshot shape above from raw store/engine fields — the
 * ONE place that knows how to project the throttled HUD snapshot down to
 * what trigger/advance predicates need. Both `useOnboardingController.ts`
 * (FTUE) and `useContextualTips.ts` (tips) call this instead of re-deriving
 * the shape themselves. */
export function toOnboardingSnapshot(s: {
  gold: number;
  stage: number;
  kills: number;
  phase: Phase;
  autoCast: boolean;
  heroes: { skillCd: number; dead: boolean }[];
}): OnboardingSnapshot {
  return {
    gold: s.gold,
    stage: s.stage,
    kills: s.kills,
    phase: s.phase,
    autoCast: s.autoCast,
    heroes: s.heroes.map((h) => ({ skillCd: h.skillCd, dead: h.dead })),
  };
}

/** CSS selector target (`data-onboarding-anchor="<value>"`) a step spotlights.
 * Omitted for steps that aren't anchored to a control (welcome/outro). */
export type OnboardingAnchor =
  "kill-progress" | "skill-bar" | "boss-panel" | "settings-row";

/** Player intents the "action" advance rule can detect via a snapshot diff.
 * Add a case here + in `didActionOccur` when a later step needs a new one. */
export type OnboardingActionKind = "castSkill" | "challengeBoss";

/** Dismiss rule for a step:
 * - `next`   — explicit "Next" tap (welcome/outro/informational steps).
 * - `action` — auto-advances the instant the player performs `action`
 *   (detected by diffing consecutive snapshots — never a button).
 * - `auto`   — auto-advances the instant `predicate(snapshot)` is true, with
 *   no player action required at all (e.g. "kills have started ticking up"). */
export type OnboardingAdvanceRule =
  | { kind: "next" }
  | { kind: "action"; action: OnboardingActionKind }
  | { kind: "auto"; predicate: (s: OnboardingSnapshot) => boolean };

export interface OnboardingStepDef {
  id: string;
  /** i18n keys: `onboarding.steps.<id>.title` / `.body` (namespace "onboarding"). */
  anchor?: OnboardingAnchor;
  advance: OnboardingAdvanceRule;
  /** Optional mascot pose for this step's dialogue (M4.8 card B, see
   * `Mascot.tsx`); omitted defaults to "neutral". */
  mood?: MascotMood;
}

/** The FTUE sequence (task M4.8). Kept short by design — 7 steps, one beat
 * per core-loop stage (kill -> gold -> upgrade -> skill -> boss -> settings). */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { id: "welcome", advance: { kind: "next" }, mood: "excited" },
  {
    id: "watchFight",
    anchor: "kill-progress",
    advance: { kind: "auto", predicate: (s) => s.kills >= 1 },
  },
  {
    // M5 pivot: the old "buyUpgrade" step's system is gone. Minimal replacement —
    // a "watch your hero grow" beat that auto-advances as kills (and thus XP)
    // accrue. Full FTUE/codex rework is a later M5 task.
    id: "watchGrow",
    anchor: "kill-progress",
    advance: { kind: "auto", predicate: (s) => s.kills >= 3 },
  },
  {
    id: "castSkill",
    anchor: "skill-bar",
    advance: { kind: "action", action: "castSkill" },
  },
  {
    id: "bossChallenge",
    anchor: "boss-panel",
    advance: { kind: "action", action: "challengeBoss" },
    mood: "warning",
  },
  { id: "settingsTour", anchor: "settings-row", advance: { kind: "next" } },
  { id: "outro", advance: { kind: "next" }, mood: "excited" },
];

/** Fresh-save heuristic (part of the "don't show returning players the
 * FTUE" gate — the other half is the persisted `ftueCompleted` flag, checked
 * by the caller). A save is "fresh" if nothing has happened yet at all. */
export function isFreshSave(s: OnboardingSnapshot): boolean {
  return s.gold === 0 && s.kills === 0 && s.stage === 1;
}

/** A real skill cast jumps a hero's cooldown from ~0 straight to its max —
 * comfortably bigger than one throttled sync tick's natural decay. */
const SKILL_CAST_JUMP_THRESHOLD = 1;

function didActionOccur(
  action: OnboardingActionKind,
  prev: OnboardingSnapshot,
  next: OnboardingSnapshot,
): boolean {
  switch (action) {
    case "castSkill":
      return next.heroes.some((h, i) => {
        const prevCd = prev.heroes[i]?.skillCd ?? 0;
        return h.skillCd > prevCd + SKILL_CAST_JUMP_THRESHOLD;
      });
    case "challengeBoss":
      return prev.phase === "battle" && next.phase === "boss";
    default:
      return false;
  }
}

/**
 * The framework's core decision function: given the current step index and
 * consecutive snapshots (plus whether the player tapped an explicit "Next"
 * this tick), returns the step index that should be shown next. A result
 * `>= steps.length` means the sequence is complete.
 *
 * Pure and DOM-free by construction — the React layer (`useOnboarding.ts`)
 * only wires this to store snapshots/effects, never re-implements the
 * decision itself.
 */
export function resolveNextStepIndex(
  steps: readonly OnboardingStepDef[],
  currentIndex: number,
  prev: OnboardingSnapshot,
  next: OnboardingSnapshot,
  tappedNext: boolean,
): number {
  if (currentIndex < 0 || currentIndex >= steps.length) return currentIndex;
  const step = steps[currentIndex];
  let advance = false;
  switch (step.advance.kind) {
    case "next":
      advance = tappedNext;
      break;
    case "action":
      advance = didActionOccur(step.advance.action, prev, next);
      break;
    case "auto":
      advance = step.advance.predicate(next);
      break;
  }
  return advance ? currentIndex + 1 : currentIndex;
}

export function isOnboardingComplete(
  steps: readonly OnboardingStepDef[],
  index: number,
): boolean {
  return index >= steps.length;
}
