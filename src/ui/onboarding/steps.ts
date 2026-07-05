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

import type { Phase, Upgrades } from "@/engine";
import type { MascotMood } from "@/ui/onboarding/mascotMood";

/** Narrow, engine-decoupled view of the throttled HUD snapshot — just the
 * fields any onboarding trigger/advance predicate might need. Deliberately
 * NOT `EngineSnapshot` itself so this module has zero store/engine coupling
 * beyond the two shared type aliases above.
 *
 * Also the SHARED snapshot type for the contextual-tips registry (`./tips.ts`,
 * M4.8 card A) — per that task's "extend the type, don't fork it" rule,
 * `upgradeCosts`/`autoUpgrade`/`autoCast`/`heroes[].dead` were added here
 * (rather than a second, parallel snapshot type) purely for tip predicates;
 * the FTUE steps below simply ignore them. */
export interface OnboardingSnapshot {
  gold: number;
  stage: number;
  kills: number;
  phase: Phase;
  upgrades: Upgrades;
  upgradeCosts: Upgrades;
  autoUpgrade: boolean;
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
  upgrades: Upgrades;
  upgradeCosts: Upgrades;
  autoUpgrade: boolean;
  autoCast: boolean;
  heroes: { skillCd: number; dead: boolean }[];
}): OnboardingSnapshot {
  return {
    gold: s.gold,
    stage: s.stage,
    kills: s.kills,
    phase: s.phase,
    upgrades: s.upgrades,
    upgradeCosts: s.upgradeCosts,
    autoUpgrade: s.autoUpgrade,
    autoCast: s.autoCast,
    heroes: s.heroes.map((h) => ({ skillCd: h.skillCd, dead: h.dead })),
  };
}

/** CSS selector target (`data-onboarding-anchor="<value>"`) a step spotlights.
 * Omitted for steps that aren't anchored to a control (welcome/outro). */
export type OnboardingAnchor =
  "kill-progress" | "upgrade-panel" | "skill-bar" | "boss-panel" | "settings-row";

/** Player intents the "action" advance rule can detect via a snapshot diff.
 * Add a case here + in `didActionOccur` when a later step needs a new one. */
export type OnboardingActionKind = "buyUpgrade" | "castSkill" | "challengeBoss";

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
    id: "buyUpgrade",
    anchor: "upgrade-panel",
    advance: { kind: "action", action: "buyUpgrade" },
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
  return (
    s.gold === 0 &&
    s.kills === 0 &&
    s.stage === 1 &&
    s.upgrades.atk === 0 &&
    s.upgrades.speed === 0 &&
    s.upgrades.hp === 0
  );
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
    case "buyUpgrade": {
      const total = (u: Upgrades) => u.atk + u.speed + u.hp;
      return total(next.upgrades) > total(prev.upgrades);
    }
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
