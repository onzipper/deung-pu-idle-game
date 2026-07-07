/**
 * Shared zone/state helpers for the biome-backed experiments (② inBiome,
 * ③ sideBySide) — factored out so both build their zone dropdown + throwaway
 * preview `GameState` the same way. Read-only `@/engine` reads only.
 */

import { CONFIG, initGameState, zoneAt, type GameState, type Zone } from "@/engine";

/** Every configured zone (town/farm×N/boss per map), resolved through the
 * PUBLIC `zoneAt()` read — mirrors `engine/systems/world.ts`'s own
 * `buildZones()` order without reaching into its internal `WORLD_ZONES`. */
export function listZoneOptions(): Zone[] {
  const zones: Zone[] = [];
  for (const m of CONFIG.world.maps) {
    let idx = 0;
    if (m.id === CONFIG.world.townMapId) {
      zones.push(zoneAt({ mapId: m.id, zoneIdx: idx }));
      idx++;
    }
    for (let i = 0; i < m.zoneStageIds.length; i++) {
      zones.push(zoneAt({ mapId: m.id, zoneIdx: idx }));
      idx++;
    }
    zones.push(zoneAt({ mapId: m.id, zoneIdx: idx })); // boss room
  }
  return zones;
}

export function zoneLabel(z: Zone): string {
  const kind = z.kind === "town" ? "เมือง" : z.kind === "boss" ? "บอส" : "ฟาร์ม";
  return `${z.mapId} · ${kind} (ด่าน ${z.stage})`;
}

/** A throwaway, fully-unlocked engine state — a dev-preview fixture only,
 * never persisted / never round-tripped back through `@/engine`. Every
 * configured map's unlock count is forced high so `BiomeScene`'s boss-door
 * prop always reads "unlocked" regardless of which zone is previewed. */
export function makeStubState(): GameState {
  const state = initGameState(1);
  for (const m of CONFIG.world.maps) state.unlockedZones[m.id] = 999;
  return state;
}
