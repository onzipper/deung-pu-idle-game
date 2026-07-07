/**
 * M7.5 Fast Travel — UI-side world-zone enumeration for the fast-travel picker.
 *
 * This mirrors `engine/systems/world.ts`'s internal (non-exported) `buildZones()`
 * off the PUBLIC `CONFIG.world` contract — same "DTO/derivation deliberately
 * redeclared at the UI boundary" convention as `ui/gear/types.ts` (the UI never
 * reaches into engine internals; `CONFIG` is the public, engine-purity-safe
 * surface). No React/fetch here (headlessly testable, `__tests__/zones.test.ts`).
 */

import { CONFIG, type ZoneKind } from "@/engine";

export interface UiZone {
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  /** Content stage (town reuses the map's first farm stage, same as the engine). */
  stage: number;
}

export interface UiMapGroup {
  mapId: string;
  zones: UiZone[];
}

function buildZones(): UiZone[] {
  const zones: UiZone[] = [];
  for (const m of CONFIG.world.maps) {
    let idx = 0;
    if (m.id === CONFIG.world.townMapId) {
      zones.push({ mapId: m.id, zoneIdx: idx++, kind: "town", stage: m.zoneStageIds[0] });
    }
    for (const stage of m.zoneStageIds) {
      zones.push({ mapId: m.id, zoneIdx: idx++, kind: "farm", stage });
    }
    zones.push({ mapId: m.id, zoneIdx: idx++, kind: "boss", stage: m.bossStageId });
  }
  return zones;
}

/** The flat, globally-ordered zone list (town, map1 farms, map1 boss, map2 …). */
export const UI_WORLD_ZONES: readonly UiZone[] = buildZones();

/** Fast-travel TARGET zones only: town + farm. Boss rooms are entered via the
 * gate/walk flow, never warped into (mirrors `startFastTravel`'s "invalid"
 * rejection for a boss-room target). */
export function fastTravelTargets(): UiZone[] {
  return UI_WORLD_ZONES.filter((z) => z.kind !== "boss");
}

/** Groups a zone list by map, preserving each map's zone order. */
export function zonesGroupedByMap(zones: readonly UiZone[]): UiMapGroup[] {
  const byMap = new Map<string, UiZone[]>();
  for (const z of zones) {
    const list = byMap.get(z.mapId);
    if (list) list.push(z);
    else byMap.set(z.mapId, [z]);
  }
  return [...byMap.entries()].map(([mapId, mapZones]) => ({ mapId, zones: mapZones }));
}

/** Mirrors `engine/systems/world.ts`'s `isZoneUnlocked` off the throttled
 * snapshot's `unlockedZones` read (a zone is unlocked iff `zoneIdx <
 * unlockedZones[mapId]`). */
export function isZoneUnlockedUi(
  loc: { mapId: string; zoneIdx: number },
  unlockedZones: Record<string, number>,
): boolean {
  return loc.zoneIdx < (unlockedZones[loc.mapId] ?? 0);
}

/** All `kind: "farm"` zones of `mapId`, in ascending `zoneIdx` order (the
 * order `buildZones` pushes them in). Used by the quest-guide "พาไปเลย"
 * button (`ui/questGuide.ts`) to pick a fast-travel destination — never a
 * boss room, fast travel can't target one. */
export function farmZonesForMap(mapId: string): UiZone[] {
  return UI_WORLD_ZONES.filter((z) => z.mapId === mapId && z.kind === "farm");
}

/** The LAST (highest-`zoneIdx`) farm zone of `mapId` — i.e. the zone right
 * before that map's boss room. Used to guide a player toward a BOSS quest
 * objective (fast travel can't warp into the boss room itself; landing on
 * the last farm zone puts the boss door one walk-right away). */
export function lastFarmZone(mapId: string): UiZone | null {
  const farms = farmZonesForMap(mapId);
  return farms.length > 0 ? farms[farms.length - 1] : null;
}

/** The highest UNLOCKED farm zone of `mapId` (or `null` if none are unlocked
 * yet). Used to guide a player toward a KILL quest objective — the deepest
 * zone they can already reach, so the guide never sends them somewhere
 * locked. */
export function highestUnlockedFarmZone(
  mapId: string,
  unlockedZones: Record<string, number>,
): UiZone | null {
  const farms = farmZonesForMap(mapId).filter((z) => isZoneUnlockedUi(z, unlockedZones));
  return farms.length > 0 ? farms[farms.length - 1] : null;
}
