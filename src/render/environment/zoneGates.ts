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
import type { Zone, ZoneKind } from "@/engine";

export type GateFamily = "map1" | "map2" | "map3" | "map4" | "map5" | "map6" | "town";

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
/** Half-width (world units) of a gate's tappable rect either side of its x —
 * `2 * DEFAULT_GATE_TAP_HALF_W` = 60, comfortably over the brief's ≥48px
 * floor (R1 W2 "tappable gates"). */
export const DEFAULT_GATE_TAP_HALF_W = 30;
/** How far above ground (world units) the tap rect extends — tall enough to
 * cover both a plain archway (`gateArch.ts`'s ~80px total height) and the
 * taller grand boss door (`bossDoor.ts`'s ~112px). */
export const DEFAULT_GATE_TAP_UP = 130;
/** How far below ground the tap rect extends (touch generosity). */
export const DEFAULT_GATE_TAP_DOWN = 14;

/**
 * Pure world-space hit test for a zone-edge gate tap — `wx`/`wy` are already
 * in WORLD coords (post letterbox+camera un-projection, see
 * `GameRenderer.hitTestGate`). No Pixi/DOM here (headlessly tested in
 * `__tests__/zoneGates.test.ts`).
 *
 * `zoneKind === "boss"` never hits — `zoneGateProps.buildZoneGateProps`
 * builds NO gate props at all inside a boss room (its own `NONE` branch;
 * `bossArena.ts`'s fixed pillars carry the "this is a place" framing for the
 * fight instead). `zoneKind === "town"` skips the LEFT side — no archway is
 * built there either (`buildZoneGateProps`'s `!isTown` guard; town is the
 * map's left-most zone, nothing to walk back through).
 */
export function gateTapSide(
  wx: number,
  wy: number,
  groundY: number,
  mapId: string,
  zoneKind: ZoneKind,
  halfW: number = DEFAULT_GATE_TAP_HALF_W,
  upH: number = DEFAULT_GATE_TAP_UP,
  downH: number = DEFAULT_GATE_TAP_DOWN,
): "left" | "right" | null {
  if (zoneKind === "boss") return null;
  if (wy < groundY - upH || wy > groundY + downH) return null;
  if (zoneKind !== "town") {
    const lx = gateX(mapId, "left");
    if (Math.abs(wx - lx) <= halfW) return "left";
  }
  const rx = gateX(mapId, "right");
  if (Math.abs(wx - rx) <= halfW) return "right";
  return null;
}

export function gateFamilyFor(mapId: string, isTown: boolean): GateFamily {
  if (isTown) return "town";
  if (mapId === "map2") return "map2";
  if (mapId === "map3") return "map3";
  if (mapId === "map4") return "map4";
  if (mapId === "map5") return "map5";
  if (mapId === "map6") return "map6";
  return "map1";
}
