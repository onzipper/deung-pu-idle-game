/**
 * Assembles the gate/door props for ONE resolved zone (M7.5 "ประตูคือตัวกลาง")
 * — `BiomeScene.ts`'s single call site. Farm/town zones get a themed archway
 * at each walkable edge (`gateArch.ts`); a map's LAST farm zone gets the
 * GRAND boss door (`bossDoor.ts`) at its right edge instead of a plain arch.
 * Boss-room biomes get nothing here — `bossArena.ts`'s own gate-pillar framing
 * already carries "this is a place" for the whole fight, and the door itself
 * is the outside (farm-zone) face of that same gate, not something redrawn
 * from the inside.
 *
 * Every prop here is FIXED screen position (added straight to the biome
 * scene's `view`, never a `ParallaxLayer` child) since every configured map
 * shares the same edge x today (`fieldWidth` = 900) — see `zoneGates.ts`.
 */

import type { Container } from "pixi.js";
import type { Zone } from "@/engine";
import { isZoneUnlocked } from "@/engine";
import type { GameState } from "@/engine/state";
import type { BiomeDef } from "@/render/environment/biomes";
import { BossDoorProp } from "@/render/environment/bossDoor";
import { buildZoneGateArch } from "@/render/environment/gateArch";
import { bossZoneIdxOf, gateFamilyFor, gateX, isLastFarmZone } from "@/render/environment/zoneGates";

export interface ZoneGateProps {
  bossDoor: BossDoorProp | null;
  /** Re-derives + applies the live locked/unlocked look; no-op if this zone
   * has no boss door. Cheap (one `isZoneUnlocked` read) — call every frame. */
  refreshLock: (state: GameState) => void;
  update: (dt: number) => void;
  destroy: () => void;
}

const NONE: ZoneGateProps = {
  bossDoor: null,
  refreshLock: () => {},
  update: () => {},
  destroy: () => {},
};

export function buildZoneGateProps(
  zone: Zone,
  biome: BiomeDef,
  groundY: number,
  container: Container,
  state: GameState,
): ZoneGateProps {
  if (biome.special === "bossRoom") return NONE;

  const family = gateFamilyFor(zone.mapId, zone.kind === "town");
  const isTown = zone.kind === "town";
  let bossDoor: BossDoorProp | null = null;

  // Left edge: every zone except town (town IS the map's left-most zone —
  // nothing to walk back through).
  if (!isTown) {
    const leftArch = buildZoneGateArch(family, gateX(zone.mapId, "left"), groundY, biome);
    container.addChild(leftArch);
  }

  // Right edge: the grand door on a map's last farm zone, a plain arch
  // everywhere else (including town's single right-side gate into farm 1).
  const rightX = gateX(zone.mapId, "right");
  if (zone.kind === "farm" && isLastFarmZone(zone)) {
    bossDoor = new BossDoorProp(rightX, groundY, family, biome);
    const bossIdx = bossZoneIdxOf(zone.mapId);
    if (bossIdx !== null) {
      bossDoor.setUnlocked(isZoneUnlocked(state, { mapId: zone.mapId, zoneIdx: bossIdx }));
    }
    container.addChild(bossDoor.view);
  } else {
    const rightArch = buildZoneGateArch(family, rightX, groundY, biome);
    container.addChild(rightArch);
  }

  const door = bossDoor;
  return {
    bossDoor: door,
    refreshLock: (s: GameState) => {
      if (!door) return;
      const bossIdx = bossZoneIdxOf(zone.mapId);
      if (bossIdx === null) return;
      door.setUnlocked(isZoneUnlocked(s, { mapId: zone.mapId, zoneIdx: bossIdx }));
    },
    update: (dt: number) => door?.update(dt),
    destroy: () => door?.destroy(),
  };
}
