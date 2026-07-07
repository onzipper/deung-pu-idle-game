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
 *  - EXCEPTION (M7.9b tier-3 quest, "young Glacial Sovereign"): when the boss
 *    objective's map equals the KILL objective's map (only ever true for the
 *    tier-3 quest — both its objectives are scoped to `killMapId`, see
 *    `engine/systems/quests.tier3QuestFor`), the boss room is NOT reachable
 *    via the map's other farm zones (the quest only grants access to zone 1
 *    + the boss room itself, not zones 2-N — `engine/systems/world`'s
 *    `questGrantsZoneAccess`). Guiding to `lastFarmZone` would send the
 *    player somewhere they can't enter. Instead this targets the FIRST farm
 *    zone (the granted frontier field — identical to the kill objective's
 *    destination) with a distinct `"bossTier3"` kind, so the caller can show
 *    "you're at the frontier, hit the challenge button" instead of the
 *    normal "walk into the boss door" toast.
 *  - EXCEPTION (tier-3 frontier GATE, owner rule 2026-07-07 "ห้ามข้ามแมพ"):
 *    while `frontierLocked` (engine `tier3FrontierLocked`), BOTH tier-3
 *    objectives are unreachable no matter their `done` state — the quest's
 *    map4 z1 grant isn't enterable yet (map3's boss room isn't
 *    persist-unlocked), so `effectiveUnlockedZones` hides it and the normal
 *    kill/boss branches below would resolve to `null` (a dead button). This
 *    branch instead routes to the player's REAL frontier (`deepestFarm`,
 *    engine `deepestUnlockedFarm`) with a distinct `"gated"` kind, checked
 *    FIRST (before the objective branches) since it overrides them entirely.
 *
 * Objective order always mirrors `QuestDef.objectives` (kill first, then
 * killBoss — see `engine/systems/quests.ts`), so "first incomplete" checks
 * kill before boss.
 */

import {
  firstFarmZone,
  highestUnlockedFarmZone,
  lastFarmZone,
  zoneByLocation,
  type UiZone,
} from "@/ui/world/zones";

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
  /** Tier-3 frontier GATE (owner rule 2026-07-07 "ห้ามข้ามแมพ") — the engine's
   * `tier3FrontierLocked(state)` read. Optional/defaults `false` so existing
   * (non-tier-3) callers/tests are unaffected. See the module doc's third
   * bullet for why this overrides the normal kill/boss branches entirely. */
  frontierLocked?: boolean;
  /** The hero's real progression frontier (engine `deepestUnlockedFarm`) —
   * only read while `frontierLocked`. */
  deepestFarm?: { mapId: string; zoneIdx: number };
}

export type QuestGuideKind = "kill" | "boss" | "bossTier3" | "gated";

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
  if (input.frontierLocked && input.deepestFarm) {
    const zone = zoneByLocation(input.deepestFarm);
    return zone ? { zone, kind: "gated" } : null;
  }
  if (!input.kill.done) {
    const mapId = input.kill.mapId ?? input.currentMapId;
    const zone = highestUnlockedFarmZone(mapId, input.unlockedZones);
    return zone ? { zone, kind: "kill" } : null;
  }
  if (!input.boss.done) {
    // Tier-3 quest exception (see module doc): boss objective scoped to the
    // SAME map as the kill objective -> the frontier field, not the last farm
    // zone (the map's other farm zones aren't quest-granted).
    if (input.boss.mapId !== null && input.boss.mapId === input.kill.mapId) {
      const zone = firstFarmZone(input.boss.mapId);
      return zone ? { zone, kind: "bossTier3" } : null;
    }
    const mapId = input.boss.mapId ?? input.currentMapId;
    const zone = lastFarmZone(mapId);
    return zone ? { zone, kind: "boss" } : null;
  }
  return null;
}
