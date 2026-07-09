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
import { CONFIG } from "@/engine/config";
import type { GameState } from "@/engine/state";
import type { BiomeDef } from "@/render/environment/biomes";
import { BOSS_DOOR_ARCH_TOP, BossDoorProp } from "@/render/environment/bossDoor";
import { ARCH_TOP, buildZoneGateArch } from "@/render/environment/gateArch";
import { GateLockOverlay } from "@/render/environment/gateLockOverlay";
import { bossZoneIdxOf, gateFamilyFor, gateX, isLastFarmZone } from "@/render/environment/zoneGates";
import { bossThemeForMap } from "@/render/views/bossThemes";

export interface ZoneGateProps {
  bossDoor: BossDoorProp | null;
  /** R1 W2 "tappable gates" — the left/right `GateLockOverlay`s (padlock +
   * kill-progress readout), exposed read-only for callers/tests to inspect
   * `isLocked()`. `leftLock` is null only in town (no left archway exists
   * there either); `rightLock` is null only for a boss-room zone (`NONE`
   * below — no gate props at all). */
  leftLock: GateLockOverlay | null;
  rightLock: GateLockOverlay | null;
  /** Re-derives + applies the live locked/unlocked look (boss door AND both
   * lock overlays); no-op for a boss-room zone. Cheap (a couple of
   * `isZoneUnlocked` reads) — call every frame. */
  refreshLock: (state: GameState) => void;
  update: (dt: number) => void;
  destroy: () => void;
}

const NONE: ZoneGateProps = {
  bossDoor: null,
  leftLock: null,
  rightLock: null,
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
  let leftLock: GateLockOverlay | null = null;
  let rightLock: GateLockOverlay | null = null;

  // Left edge: every zone except town (town IS the map's left-most zone —
  // nothing to walk back through). Always OPEN — the way back is never
  // locked (you had to unlock this zone to be standing in it) — so the
  // overlay just carries the inviting glow, never the padlock/bar.
  if (!isTown) {
    const leftX = gateX(zone.mapId, "left");
    const leftArch = buildZoneGateArch(family, leftX, groundY, biome);
    container.addChild(leftArch);
    leftLock = new GateLockOverlay(leftX, groundY, ARCH_TOP);
    leftLock.setState(false, 1, 1);
    container.addChild(leftLock.view);
  }

  // Right edge: the grand door on a map's last farm zone, a plain arch
  // everywhere else (including town's single right-side gate into farm 1).
  // Both flavors pair with a `GateLockOverlay` fed the SAME `state.kills` /
  // `CONFIG.killGoal(zone.stage)` values the HUD's own kill-progress gauge
  // reads (R1 W2 "tappable gates" — no second source of truth).
  const rightX = gateX(zone.mapId, "right");
  const nextLoc = { mapId: zone.mapId, zoneIdx: zone.zoneIdx + 1 };
  if (zone.kind === "farm" && isLastFarmZone(zone)) {
    // Boss-theme tint (R1 W2): the door's glow reads as THIS boss's own
    // identity color, not just the biome's generic accent.
    const theme = bossThemeForMap(zone.mapId);
    bossDoor = new BossDoorProp(rightX, groundY, family, biome, theme.crownColor);
    const bossIdx = bossZoneIdxOf(zone.mapId);
    if (bossIdx !== null) {
      bossDoor.setUnlocked(isZoneUnlocked(state, { mapId: zone.mapId, zoneIdx: bossIdx }));
    }
    container.addChild(bossDoor.view);
    rightLock = new GateLockOverlay(rightX, groundY, BOSS_DOOR_ARCH_TOP);
    container.addChild(rightLock.view);
  } else {
    const rightArch = buildZoneGateArch(family, rightX, groundY, biome);
    container.addChild(rightArch);
    rightLock = new GateLockOverlay(rightX, groundY, ARCH_TOP);
    container.addChild(rightLock.view);
  }

  const door = bossDoor;
  return {
    bossDoor: door,
    leftLock,
    rightLock,
    refreshLock: (s: GameState) => {
      if (door) {
        const bossIdx = bossZoneIdxOf(zone.mapId);
        if (bossIdx !== null) {
          door.setUnlocked(isZoneUnlocked(s, { mapId: zone.mapId, zoneIdx: bossIdx }));
        }
      }
      if (rightLock) {
        const unlocked = isZoneUnlocked(s, nextLoc);
        rightLock.setState(!unlocked, s.kills, CONFIG.killGoal(zone.stage));
      }
    },
    update: (dt: number) => {
      door?.update(dt);
      leftLock?.update(dt);
      rightLock?.update(dt);
    },
    destroy: () => {
      door?.destroy();
      leftLock?.destroy();
      rightLock?.destroy();
    },
  };
}
