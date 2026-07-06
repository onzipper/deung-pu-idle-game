/**
 * Zone-gate geometry + family lookups (M7.5 "ประตูคือตัวกลาง") — pure helpers
 * shared by `gateArch.ts` (normal zone-edge archways), `bossDoor.ts` (the
 * grand boss-room door), `BiomeScene.ts` (placement), and `fx/FxController.ts`
 * (event x-positions + the boss-door unlock beat detection).
 *
 * `engine/systems/world.ts` owns the REAL `gateX`/zone-list internals, but
 * only exports `zoneAt`/`worldNav`/`isZoneUnlocked`/`firstFarmLocation` on the
 * public `@/engine` barrel (see that file) — render has no sanctioned way to
 * import `gateX`/`WORLD_ZONES` directly. Every helper below is instead derived
 * from `CONFIG` alone (already a public, render-safe read used throughout
 * `render/`), mirroring the engine's own math exactly (same `heroMinX`/
 * `fieldRightMargin`/`fieldWidth` fields) — a plain read of shared config, not
 * a reach into engine internals.
 */

import { CONFIG } from "@/engine/config";
import type { Zone } from "@/engine";

export type GateFamily = "map1" | "map2" | "map3" | "town";

function mapConfigOf(mapId: string) {
  return CONFIG.world.maps.find((m) => m.id === mapId);
}

/** A map's walkable field width (defaults to 900, matching `render/layout.ts`'s
 * `WORLD_WIDTH` — every configured map uses that default today). */
export function fieldWidthOf(mapId: string): number {
  return mapConfigOf(mapId)?.fieldWidth ?? 900;
}

/** The x of a zone's left/right edge GATE — mirrors `engine/systems/world.ts`'s
 * internal `gateX` exactly (same two CONFIG fields), so the fixed archway/door
 * props line up with where the engine actually walks the hero through. */
export function gateX(mapId: string, side: "left" | "right"): number {
  return side === "left"
    ? CONFIG.hunt.heroMinX
    : fieldWidthOf(mapId) - CONFIG.hunt.fieldRightMargin;
}

/** The boss room's zoneIdx for a map — always immediately after its last farm
 * zone (`engine/systems/world.ts`'s `buildZones()`: town? -> farm×N -> boss).
 * Null for an unconfigured mapId (frontier-overflow content beyond the
 * authored maps — no dedicated door there yet). */
export function bossZoneIdxOf(mapId: string): number | null {
  const m = mapConfigOf(mapId);
  if (!m) return null;
  const hasTown = mapId === CONFIG.world.townMapId;
  return (hasTown ? 1 : 0) + m.zoneStageIds.length;
}

/** True when `zoneIdx` in `mapId` addresses that map's boss room — lets
 * `FxController` tell a generic `zoneUnlocked` apart from "the boss room JUST
 * unlocked" (the door's outside-face unlock beat). */
export function isBossZoneIdx(mapId: string, zoneIdx: number): boolean {
  return bossZoneIdxOf(mapId) === zoneIdx;
}

/** True when `zone` is the LAST farm zone of its map — the one whose RIGHT
 * gate leads to the boss room, so it gets the grand door instead of a plain
 * archway (M7.5 item 3). */
export function isLastFarmZone(zone: Zone): boolean {
  const m = mapConfigOf(zone.mapId);
  if (!m || zone.kind !== "farm") return false;
  return zone.stage === m.zoneStageIds[m.zoneStageIds.length - 1];
}

/** Which prop vocabulary a gate/door should draw — decoupled from `biome.id`
 * (many hue-loop biome variants can share one map's family) so `gateArch.ts`/
 * `bossDoor.ts` need only one switch each. */
export function gateFamilyFor(mapId: string, isTown: boolean): GateFamily {
  if (isTown) return "town";
  if (mapId === "map2") return "map2";
  if (mapId === "map3") return "map3";
  return "map1";
}
