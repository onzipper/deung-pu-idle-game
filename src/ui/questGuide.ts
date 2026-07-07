/**
 * Pure selection logic for the quest card's "พาไปเลย" (Guide me) button
 * (owner-approved quest UX upgrade). Same "narrow, store-decoupled input +
 * headlessly-testable pure function" pattern as `goalLadder.ts` /
 * `onboarding/steps.ts`.
 *
 * Picks the fast-travel destination for the hero's FIRST incomplete
 * objective of their active evolution quest:
 *  - a KILL objective sends the player to the highest UNLOCKED farm zone of
 *    the objective's map (or the CURRENT map if the objective is unscoped —
 *    the tier-1 class-change quest's kill objective counts anywhere);
 *  - a BOSS objective sends the player to the LAST farm zone of the boss's
 *    map (fast travel can never target a boss room — `zones.ts`'s
 *    `lastFarmZone` — landing there puts the boss door one walk-right away;
 *    a companion toast tells them to walk in). Unscoped (tier-1's "any
 *    boss") resolves to the CURRENT map, same as the kill case.
 *
 * Objective order always mirrors `QuestDef.objectives` (kill first, then
 * killBoss — see `engine/systems/quests.ts`), so "first incomplete" checks
 * kill before boss.
 */

import { highestUnlockedFarmZone, lastFarmZone, type UiZone } from "@/ui/world/zones";

/** One objective's guide-relevant state: its map scope (`null` = unscoped,
 * counts anywhere) and whether it's already satisfied. */
export interface QuestGuideObjective {
  mapId: string | null;
  done: boolean;
}

export interface QuestGuideInput {
  kill: QuestGuideObjective;
  boss: QuestGuideObjective;
  /** The hero's current map (used to resolve unscoped objectives). */
  currentMapId: string;
  unlockedZones: Record<string, number>;
}

export type QuestGuideKind = "kill" | "boss";

export interface QuestGuideTarget {
  zone: UiZone;
  /** Which objective this destination serves — `"boss"` drives the
   * companion "walk into the boss door" toast. */
  kind: QuestGuideKind;
}

/** The guide button's destination, or `null` when both objectives are done
 * (nothing left to guide toward) or no valid zone could be resolved (e.g. the
 * kill objective's map has no unlocked farm zone yet — shouldn't normally
 * happen, since reaching a map's grind implies it's already unlocked). */
export function selectQuestGuideTarget(input: QuestGuideInput): QuestGuideTarget | null {
  if (!input.kill.done) {
    const mapId = input.kill.mapId ?? input.currentMapId;
    const zone = highestUnlockedFarmZone(mapId, input.unlockedZones);
    return zone ? { zone, kind: "kill" } : null;
  }
  if (!input.boss.done) {
    const mapId = input.boss.mapId ?? input.currentMapId;
    const zone = lastFarmZone(mapId);
    return zone ? { zone, kind: "boss" } : null;
  }
  return null;
}
