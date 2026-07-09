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

import type { HeroStats, Phase } from "@/engine";
import type { MascotMood } from "@/ui/onboarding/mascotMood";

/** Narrow, engine-decoupled view of a hero for onboarding trigger/advance
 * predicates — just the fields any FTUE step or contextual tip might need.
 * `statsSum`/`autoSlotsFilled` are precomputed by `toOnboardingSnapshot` (from
 * the fuller `stats`/`autoSlots` shape the store actually carries) so the
 * pure decision functions below only ever compare cheap numbers, never
 * re-derive them. */
export interface OnboardingHeroSnapshot {
  skillCd: number;
  dead: boolean;
  /** Class-advancement tier (M7.9 "Grand Expansion" adds tier 3) — lets a
   * contextual tip distinguish WHICH evolution's quest/slot-unlock just fired
   * (e.g. the tier-2 -> tier-3 quest-offered tip vs the original tier-1 one). */
  tier: 1 | 2 | 3;
  /** Sum of str+dex+int+vit — rises by exactly the allocated amount on a
   * manual (or auto) stat spend, and NEVER on a level-up alone (which only
   * grants unspent points), so an increase unambiguously means "a point was
   * spent". */
  statsSum: number;
  /** Unspent base-stat points (M5 "Base stats") — drives the pile-up tip. */
  statPoints: number;
  /** How many auto-cast slots are unlocked at this hero's level (M5 "skill
   * framework v2": unlocks at Lv 1/15/30) — drives the "new slot" tip. */
  unlockedSlots: number;
  /** Count of auto-cast slots currently holding a skill — rises the instant
   * the player taps a skill's AUTO badge. */
  autoSlotsFilled: number;
  /** Class-change quest (M5 task 5) is offerable right now. */
  questOffered: boolean;
  /** Class-change quest objectives are all met (class change available). */
  questComplete: boolean;
}

/** Narrow, engine-decoupled view of the throttled HUD snapshot — just the
 * fields any onboarding trigger/advance predicate might need. Deliberately
 * NOT `EngineSnapshot` itself so this module has zero store/engine coupling.
 *
 * Also the SHARED snapshot type for the contextual-tips registry (`./tips.ts`). */
export interface OnboardingSnapshot {
  gold: number;
  stage: number;
  kills: number;
  phase: Phase;
  autoCast: boolean;
  /** UI-owned "auto-allocate stat points" toggle (M5) — mirrors `autoCast`. */
  autoAllocate: boolean;
  /** Engine-persisted auto-hunt toggle (M6.6/M7.5, SAVE v12) — drives the
   * M7.8 "Manual Play" contextual tip (fires the first time it flips off). */
  autoHunt: boolean;
  /** Standing in the town zone right now (`world.kind === "town"`) — drives
   * the Town NPCs phase 3 (final) "tap NPCs to talk" contextual tip (fires on
   * the first battle/boss -> town edge, not at boot). */
  inTown: boolean;
  /** Count of "แกร่ง" fortifier item instances (`fort_weapon`/`fort_armor`,
   * see `engine/config/items.ts`'s `FORTIFIER_TEMPLATES`) currently held in
   * the inventory — a UI/client-owned slice, not engine state, but projected
   * in here the same way as every other field so the `fortifierGained`
   * contextual tip can diff it like anything else. Drives that tip's
   * once-ever "you just got your first fortifier" guide (fires on the count
   * RISING, never merely being nonzero — a returning player who already held
   * one before this tip shipped is not retroactively taught). */
  fortifierCount: number;
  heroes: OnboardingHeroSnapshot[];
}

/** Builds the shared snapshot shape above from raw store/engine fields — the
 * ONE place that knows how to project the throttled HUD snapshot down to
 * what trigger/advance predicates need. Both `useOnboardingController.ts`
 * (FTUE) and `useContextualTips.ts` (tips) call this instead of re-deriving
 * the shape themselves. Accepts the store's actual `HeroSummary` shape (a
 * structural subset — no import needed here, keeping this module dependency-
 * light) rather than redeclaring every field verbatim. */
export function toOnboardingSnapshot(s: {
  gold: number;
  stage: number;
  kills: number;
  phase: Phase;
  autoCast: boolean;
  autoAllocate: boolean;
  autoHunt: boolean;
  inTown: boolean;
  fortifierCount: number;
  heroes: {
    skillCd: number;
    dead: boolean;
    tier: 1 | 2 | 3;
    stats: HeroStats;
    statPoints: number;
    unlockedSlots: number;
    autoSlots: (string | null)[];
    quest: { offered: boolean; complete: boolean } | null;
  }[];
}): OnboardingSnapshot {
  return {
    gold: s.gold,
    stage: s.stage,
    kills: s.kills,
    phase: s.phase,
    autoCast: s.autoCast,
    autoAllocate: s.autoAllocate,
    autoHunt: s.autoHunt,
    inTown: s.inTown,
    fortifierCount: s.fortifierCount,
    heroes: s.heroes.map((h) => ({
      skillCd: h.skillCd,
      dead: h.dead,
      tier: h.tier,
      statsSum: h.stats.str + h.stats.dex + h.stats.int + h.stats.vit,
      statPoints: h.statPoints,
      unlockedSlots: h.unlockedSlots,
      autoSlotsFilled: h.autoSlots.filter((id) => id !== null).length,
      questOffered: h.quest?.offered ?? false,
      questComplete: h.quest?.complete ?? false,
    })),
  };
}

/** CSS selector target (`data-onboarding-anchor="<value>"`) a step spotlights.
 * Omitted for steps that aren't anchored to a control (welcome/outro). */
export type OnboardingAnchor =
  | "kill-progress"
  /** R2-W2 "fullscreen HUD": the top-right icon-menu-row trigger that opens
   * the "ตัวละคร" `CharacterPanel` (stat points + equipped loadout + switch
   * character) — was `stat-panel`, spotlighting `StatPanel.tsx` directly
   * in-flow, before that panel moved behind this trigger
   * (`CharacterButton.tsx`). */
  | "character-menu"
  | "skill-bar"
  | "boss-panel"
  /** R2-W2 "fullscreen HUD": the top-right icon menu row itself (settings +
   * codex/guide + …) — was `settings-row`, the old in-flow console-dock row
   * those buttons used to share. */
  | "menu-row"
  /** The bot MASTER switch (`BotMasterSwitch.tsx`, owner UX consolidation
   * 2026-07-07) — see the `botSwitchIntro` step below. */
  | "bot-master"
  /** The WHOLE goal-ladder card (`GoalLadder.tsx`'s outer container) — the
   * class-change quest's accept/change-class controls live inside it now
   * (UX-fix wave, moved off `skill-bar`), so quest-related tips spotlight
   * this instead. */
  | "goal-ladder";

/** Player intents the "action" advance rule can detect via a snapshot diff.
 * Add a case here + in `didActionOccur` when a later step needs a new one. */
export type OnboardingActionKind =
  "castSkill" | "challengeBoss" | "allocateStat" | "setAutoSlot";

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

/** The FTUE sequence (M5 Character Pivot rework — the player arrives from
 * `/characters` having ALREADY created a character and picked a class, so
 * this teaches the solo-hero loop: watch it fight -> spend stat points on
 * level-up -> cast/slot skills (mana, not gold) -> challenge the boss ->
 * settings/codex. Kept short by design — 8 steps, one beat per core-loop
 * stage. The old "buyUpgrade"/"watchGrow" placeholder is gone; upgrade lines
 * no longer exist in this game. */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { id: "welcome", advance: { kind: "next" }, mood: "excited" },
  {
    id: "watchFight",
    anchor: "kill-progress",
    advance: { kind: "auto", predicate: (s) => s.kills >= 1 },
  },
  {
    // Level-ups grant 3 base-stat points to allocate (M5 "Base stats") — the
    // hero's own power growth now that upgrade lines are gone. R2-W2: points
    // spend from inside the "ตัวละคร" panel now, so this spotlights its
    // top-right menu-row trigger instead of the (now-hidden-behind-a-modal)
    // stat panel directly.
    id: "allocateStats",
    anchor: "character-menu",
    advance: { kind: "action", action: "allocateStat" },
  },
  {
    // Skills cost mana + cooldown (M5 "mana + skill framework v2").
    id: "castSkill",
    anchor: "skill-bar",
    advance: { kind: "action", action: "castSkill" },
  },
  {
    // Up to 3 auto-cast slots, unlocked by level; skills outside a slot are
    // cast manually.
    id: "slotAutoSkill",
    anchor: "skill-bar",
    advance: { kind: "action", action: "setAutoSlot" },
  },
  {
    // Owner UX consolidation (2026-07-07): introduces the ONE bot master
    // switch that gates every automation sub-behavior just shown above
    // (auto-slotting) plus the ones still to come (auto-allocate, auto-
    // potion, bot town trips, auto-advance) — right after the player has
    // just learned "the hero can act on its own", teach them where the
    // off-switch for all of that lives.
    id: "botSwitchIntro",
    anchor: "bot-master",
    advance: { kind: "next" },
  },
  {
    id: "bossChallenge",
    anchor: "boss-panel",
    advance: { kind: "action", action: "challengeBoss" },
    mood: "warning",
  },
  { id: "settingsTour", anchor: "menu-row", advance: { kind: "next" } },
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
    case "allocateStat":
      return next.heroes.some((h, i) => h.statsSum > (prev.heroes[i]?.statsSum ?? 0));
    case "setAutoSlot":
      return next.heroes.some(
        (h, i) => h.autoSlotsFilled > (prev.heroes[i]?.autoSlotsFilled ?? 0),
      );
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
