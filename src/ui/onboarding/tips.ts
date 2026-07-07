/**
 * Contextual tutorial hooks (M4.8 card A) — a SECOND, independent registry
 * from the linear FTUE (`./steps.ts`): one-off tips that fire the first time
 * a system becomes RELEVANT (progressive disclosure) rather than at a fixed
 * point in a fixed sequence. Pure TS (no React/DOM), same headless-testability
 * contract as `steps.ts` — `useContextualTips.ts` is the only React glue.
 *
 * Reuses `OnboardingSnapshot` and `OnboardingAnchor`/the spotlight-tooltip
 * rendering (`TutorialOverlayShell.tsx`) rather than forking either — per the
 * task's "extend the framework minimally... if it truly needs a new field,
 * extend the type, don't fork it" rule.
 *
 * A tip's `trigger(prev, next)` mirrors the FTUE's action/auto advance
 * predicates: most tips only read `next` (a level check is enough since
 * "already seen" persistence guarantees at most one fire ever), but
 * `bossWipe`/`autoSlotUnlocked` need the `prev` edge so they aren't confused
 * with the game's initial state at boot.
 *
 * FUTURE MILESTONES add tips by APPENDING `CONTEXTUAL_TIPS` entries (+
 * matching `messages/*.json` "onboarding.tips.<id>" keys) — no other file's
 * shape should need to change, mirroring `steps.ts`'s own extension contract.
 */

import type { OnboardingAnchor, OnboardingSnapshot } from "@/ui/onboarding/steps";
import type { MascotMood } from "@/ui/onboarding/mascotMood";

export type ContextualTipTrigger = (
  prev: OnboardingSnapshot,
  next: OnboardingSnapshot,
) => boolean;

export interface ContextualTipDef {
  id: string;
  /** i18n keys: `onboarding.tips.<id>.title` / `.body` (namespace "onboarding"). */
  anchor?: OnboardingAnchor;
  /** Optional mascot pose for this tip's dialogue (see `Mascot.tsx`);
   * omitted defaults to "neutral". */
  mood?: MascotMood;
  /** Fires the tip the instant this returns true, for as long as its `id`
   * hasn't been marked "seen" yet (see `resolveTriggeredTip`). */
  trigger: ContextualTipTrigger;
}

function anyHeroReady(s: OnboardingSnapshot): boolean {
  return s.heroes.some((h) => !h.dead && h.skillCd <= 0);
}

/**
 * Ship list (M5 Character Pivot rework) — 8 tips, one per real, detectable
 * moment that exists in the game TODAY (registry order = priority when more
 * than one would trigger on the same tick; `resolveTriggeredTip` picks the
 * first not-yet-seen match):
 *  - `heroDeathRespawn`: the hero has gone down for the first time — explains
 *    the auto-respawn timer rather than the player assuming it's permanent.
 *  - `autoCastAvailable`: the moment a skill first comes off cooldown while
 *    auto-cast is still off — nudges toward slotting/automating it.
 *  - `questOffered`: the class-change quest first becomes offerable (Lv 15)
 *    — points at the "รับเควส" accept button next to the level badge.
 *  - `questComplete`: the class-change quest's objectives are all met —
 *    points at the "เปลี่ยนคลาส!" button.
 *  - `autoSlotUnlocked`: a hero's auto-cast slot count just went UP
 *    (Lv 15/30) — a fresh slot just opened up to fill.
 *  - `statPointsPiling`: unspent stat points have piled up (>9) while
 *    auto-allocate is off — nudges toward spending them or automating.
 *  - `stageClear`: the boss just went down for the first time — points at
 *    the victory panel's "next stage" button.
 *  - `bossWipe`: the hero just got wiped by a boss (a phase boss -> battle
 *    transition, distinct from the game's initial "battle" phase at boot) —
 *    explains the no-penalty respawn (bossReady stays true).
 *
 * M7.9 "Grand Expansion" appends two more (registry order = lower priority
 * than the tier-1 originals above, mirroring how the tier-2/-3 evolution
 * itself comes later in a run):
 *  - `tier3QuestOffered`: the M7.9 tier-2 -> tier-3 quest first becomes
 *    offerable (Lv.40) — same "รับเควส" accept button, distinct id from
 *    `questOffered` (tier-1) so BOTH fire once each across a run.
 *  - `skill4Unlocked`: a hero's auto-cast slot count just reached the tier-3
 *    4th slot — distinct id from `autoSlotUnlocked` (tier-1/2's Lv 15/30
 *    slots) so both fire once each.
 */
export const CONTEXTUAL_TIPS: readonly ContextualTipDef[] = [
  {
    id: "heroDeathRespawn",
    anchor: "skill-bar",
    mood: "warning",
    trigger: (_prev, next) => next.heroes.some((h) => h.dead),
  },
  {
    id: "autoCastAvailable",
    anchor: "skill-bar",
    mood: "excited",
    trigger: (_prev, next) => !next.autoCast && anyHeroReady(next),
  },
  {
    id: "questOffered",
    anchor: "goal-ladder",
    mood: "excited",
    trigger: (_prev, next) => next.heroes.some((h) => h.questOffered),
  },
  {
    id: "questComplete",
    anchor: "goal-ladder",
    mood: "excited",
    trigger: (_prev, next) => next.heroes.some((h) => h.questComplete),
  },
  {
    id: "autoSlotUnlocked",
    anchor: "skill-bar",
    mood: "excited",
    trigger: (prev, next) =>
      next.heroes.some(
        (h, i) => h.unlockedSlots > (prev.heroes[i]?.unlockedSlots ?? h.unlockedSlots),
      ),
  },
  {
    id: "statPointsPiling",
    anchor: "stat-panel",
    mood: "warning",
    trigger: (_prev, next) =>
      !next.autoAllocate && next.heroes.some((h) => h.statPoints > 9),
  },
  {
    id: "stageClear",
    anchor: "boss-panel",
    mood: "excited",
    trigger: (_prev, next) => next.phase === "victory",
  },
  {
    id: "bossWipe",
    anchor: "boss-panel",
    mood: "warning",
    trigger: (prev, next) => prev.phase === "boss" && next.phase === "battle",
  },
  /**
   * `manualPlayHint` (M7.8 "Manual Play"): the first time the player turns
   * AUTO off — explains the RO-style tap-to-move / tap-to-attack controls
   * that now drive the hero instead of auto-hunt. No anchor (the canvas
   * itself, not a HUD control, is what it's pointing at).
   */
  {
    id: "manualPlayHint",
    mood: "excited",
    trigger: (prev, next) => prev.autoHunt && !next.autoHunt,
  },
  {
    id: "tier3QuestOffered",
    anchor: "goal-ladder",
    mood: "excited",
    trigger: (_prev, next) => next.heroes.some((h) => h.tier === 2 && h.questOffered),
  },
  {
    id: "skill4Unlocked",
    anchor: "skill-bar",
    mood: "excited",
    trigger: (prev, next) =>
      next.heroes.some(
        (h, i) => h.unlockedSlots >= 4 && (prev.heroes[i]?.unlockedSlots ?? 0) < 4,
      ),
  },
  /**
   * `townNpcTapHint` (Town NPCs phase 3, final): the first time the player
   * arrives in town after this feature ships — explains that ป้าปุ๊/ลุงดึ๋ง are
   * now tap-again-to-talk (approach on the first tap, dialog opens on the
   * second) instead of an always-open panel. No anchor (points at the town
   * NPCs on the canvas itself, not a HUD control — same as `manualPlayHint`).
   */
  {
    id: "townNpcTapHint",
    mood: "excited",
    trigger: (prev, next) => !prev.inTown && next.inTown,
  },
];

/**
 * The framework's core decision function (mirrors FTUE's
 * `resolveNextStepIndex`): the first not-yet-seen tip whose trigger fires
 * this tick, or `null`. Pure and DOM-free by construction — `useContextualTips.ts`
 * owns the localStorage/React side of "seen", never re-implements this.
 */
export function resolveTriggeredTip(
  tips: readonly ContextualTipDef[],
  seenIds: ReadonlySet<string>,
  prev: OnboardingSnapshot,
  next: OnboardingSnapshot,
): string | null {
  for (const tip of tips) {
    if (seenIds.has(tip.id)) continue;
    if (tip.trigger(prev, next)) return tip.id;
  }
  return null;
}

export function tipById(id: string): ContextualTipDef | undefined {
  return CONTEXTUAL_TIPS.find((t) => t.id === id);
}

/** Required `onboarding` namespace-relative i18n keys for a tip (used by the
 * component and the headless coverage test — single source of truth for
 * "which keys must exist", same pattern as codex's `codexEntryRequiredKeys`). */
export function tipRequiredKeys(tip: ContextualTipDef): string[] {
  return [`tips.${tip.id}.title`, `tips.${tip.id}.body`];
}
