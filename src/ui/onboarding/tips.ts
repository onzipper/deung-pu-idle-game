/**
 * Contextual tutorial hooks (M4.8 card A) — a SECOND, independent registry
 * from the linear FTUE (`./steps.ts`): one-off tips that fire the first time
 * a system becomes RELEVANT (progressive disclosure) rather than at a fixed
 * point in a fixed sequence. Pure TS (no React/DOM), same headless-testability
 * contract as `steps.ts` — `useContextualTips.ts` is the only React glue.
 *
 * Reuses `OnboardingSnapshot` (extended in `steps.ts` with the extra fields
 * tips need) and `OnboardingAnchor`/the spotlight-tooltip rendering
 * (`TutorialOverlayShell.tsx`) rather than forking either — per the task's
 * "extend the framework minimally... if it truly needs a new field, extend
 * the type, don't fork it" rule.
 *
 * A tip's `trigger(prev, next)` mirrors the FTUE's action/auto advance
 * predicates: most tips only read `next` (a level check is enough since
 * "already seen" persistence guarantees at most one fire ever), but
 * `bossWipe` needs the `prev` edge (phase boss -> battle) so it isn't
 * confused with the game's initial "battle" phase at boot.
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

function cheapestUpgradeCost(s: OnboardingSnapshot): number {
  return Math.min(s.upgradeCosts.atk, s.upgradeCosts.speed, s.upgradeCosts.hp);
}

function anyHeroReady(s: OnboardingSnapshot): boolean {
  return s.heroes.some((h) => !h.dead && h.skillCd <= 0);
}

/**
 * Ship list (M4.8 card A) — 5 tips, one per real, detectable moment that
 * exists in the game TODAY (registry order = priority when more than one
 * would trigger on the same tick; `resolveTriggeredTip` picks the first
 * not-yet-seen match):
 *  - `heroDeathRespawn`: a hero has gone down for the first time — explains
 *    the auto-revive timer (the "dead" skill-bar badge) rather than the
 *    player assuming it's permanent.
 *  - `autoUpgradeAvailable` / `autoCastAvailable`: the moment an upgrade
 *    first becomes affordable / a skill first comes off cooldown while its
 *    respective auto-toggle is still off — nudges toward automating it.
 *  - `stageClear`: the boss just went down for the first time — points at
 *    the victory panel's "next stage" button.
 *  - `bossWipe`: the whole team just got wiped by a boss (a phase
 *    boss -> battle transition, distinct from the game's initial "battle"
 *    phase at boot) — explains retry/grind (bossReady stays true).
 */
export const CONTEXTUAL_TIPS: readonly ContextualTipDef[] = [
  {
    id: "heroDeathRespawn",
    anchor: "skill-bar",
    mood: "warning",
    trigger: (_prev, next) => next.heroes.some((h) => h.dead),
  },
  {
    id: "autoUpgradeAvailable",
    anchor: "upgrade-panel",
    mood: "excited",
    trigger: (_prev, next) => !next.autoUpgrade && next.gold >= cheapestUpgradeCost(next),
  },
  {
    id: "autoCastAvailable",
    anchor: "skill-bar",
    mood: "excited",
    trigger: (_prev, next) => !next.autoCast && anyHeroReady(next),
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
