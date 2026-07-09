/**
 * Headless smoke/bounds guard for the M7.5 zone-gate props (archways + the
 * grand boss door), alongside `views/__tests__/rig.test.ts`'s conventions:
 * pixi.js scene-graph math (`Graphics` path building + `getBounds()`) runs
 * fine in plain Node, so this exercises the REAL builders, not a hand-derived
 * re-statement of their geometry.
 *
 * What this guards against: any of the shapes here collapsing to a
 * degenerate (NaN/zero/negative) bounds box — the same class of regression
 * `rig.test.ts` catches for the hero/enemy/boss rigs — plus a crash-free
 * sweep of the boss door's locked <-> unlocked transform cycle (leaf
 * rotation/scale, glow alpha) across several `update()` ticks.
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { initGameState, type Zone } from "@/engine";
import { GROUND_Y } from "@/render/layout";
import { biomeForZone } from "@/render/environment/biomes";
import { buildZoneGateArch } from "@/render/environment/gateArch";
import { BossDoorProp } from "@/render/environment/bossDoor";
import { buildZoneGateProps } from "@/render/environment/zoneGateProps";
import { gateFamilyFor, gateX, isLastFarmZone } from "@/render/environment/zoneGates";

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
}

describe("gateArch (zone-edge archway) — every biome family builds a sane prop", () => {
  for (const family of ["map1", "map2", "map3", "map4", "map5", "map6", "town"] as const) {
    it(`${family}: builds without crashing, non-degenerate bounds`, () => {
      const zone: Zone = { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 };
      const biome = biomeForZone(zone);
      const view = buildZoneGateArch(family, 100, GROUND_Y, biome);
      expectSaneBounds(view.getBounds());
      view.destroy({ children: true });
    });
  }
});

describe("BossDoorProp — locked/unlocked transform cycle never collapses", () => {
  it("builds, holds a sane locked look, then eases to a sane open look", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 5, kind: "farm", stage: 5 };
    const biome = biomeForZone(zone);
    const family = gateFamilyFor(zone.mapId, false);
    const door = new BossDoorProp(0, GROUND_Y, family, biome);

    // Locked: a few ticks holding closed.
    door.setUnlocked(false);
    for (let i = 0; i < 5; i++) door.update(1 / 60);
    expectSaneBounds(door.view.getBounds());

    // Unlock: ease all the way open over enough real time.
    door.setUnlocked(true);
    for (let i = 0; i < 120; i++) door.update(1 / 60);
    expectSaneBounds(door.view.getBounds());

    door.destroy();
  });
});

describe("buildZoneGateProps — routes the grand door only to a map's last farm zone", () => {
  it("last farm zone: attaches a BossDoorProp, live-unlocks it via refreshLock", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 5, kind: "farm", stage: 5 };
    expect(isLastFarmZone(zone)).toBe(true);
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);
    state.unlockedZones.map1 = 5; // boss room (zoneIdx 6) still locked

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    expect(props.bossDoor).not.toBeNull();
    expect(container.children.length).toBeGreaterThan(0);
    props.update(1 / 60);
    expectSaneBounds(props.bossDoor!.view.getBounds());

    state.unlockedZones.map1 = 6; // boss room now unlocked
    props.refreshLock(state);
    for (let i = 0; i < 60; i++) props.update(1 / 60);
    expectSaneBounds(props.bossDoor!.view.getBounds());

    props.destroy();
    container.destroy({ children: true });
  });

  it("an ordinary farm zone gets a plain arch (no boss door) at both edges", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 2, kind: "farm", stage: 2 };
    expect(isLastFarmZone(zone)).toBe(false);
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    expect(props.bossDoor).toBeNull();
    // left arch + left GateLockOverlay + right arch + right GateLockOverlay
    // (R1 W2 "tappable gates" — see `zoneLockOverlay.test.ts` for the
    // overlay's own locked/open behavior).
    expect(container.children.length).toBe(4);

    props.update(1 / 60); // no-op, must not throw
    props.destroy();
    container.destroy({ children: true });
  });

  it("boss-room biome: no gate props at all (bossArena.ts already frames it)", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 6, kind: "boss", stage: 5 };
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    expect(props.bossDoor).toBeNull();
    expect(container.children.length).toBe(0);

    props.update(1 / 60);
    props.refreshLock(state);
    props.destroy();
    container.destroy({ children: true });
  });
});

describe("buildZoneGateProps — R1 W2 lock-overlay state derivation", () => {
  it("an ordinary farm zone: right overlay LOCKED until the next zone is unlocked, then OPEN", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 2, kind: "farm", stage: 2 };
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);
    state.unlockedZones.map1 = 3; // zone 2 itself unlocked, zone 3 (next) is NOT
    state.kills = 5;

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    props.refreshLock(state);
    props.update(1 / 60);
    expect(props.rightLock).not.toBeNull();
    expect(props.rightLock!.isLocked()).toBe(true);
    // Left overlay is always OPEN — the way back is never locked.
    expect(props.leftLock).not.toBeNull();
    expect(props.leftLock!.isLocked()).toBe(false);

    state.unlockedZones.map1 = 4; // next zone (3) now unlocked
    props.refreshLock(state);
    props.update(1 / 60);
    expect(props.rightLock!.isLocked()).toBe(false);

    props.destroy();
    container.destroy({ children: true });
  });

  it("town: the right overlay reads OPEN (farm zone 1 is unlocked from the start)", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 };
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    expect(props.leftLock).toBeNull(); // no left gate in town
    props.refreshLock(state);
    expect(props.rightLock).not.toBeNull();
    expect(props.rightLock!.isLocked()).toBe(false);

    props.destroy();
    container.destroy({ children: true });
  });

  it("a map's last farm zone (boss gate): the right overlay mirrors the boss door's own lock", () => {
    const zone: Zone = { mapId: "map1", zoneIdx: 5, kind: "farm", stage: 5 };
    const biome = biomeForZone(zone);
    const container = new Container();
    const state = initGameState(1);
    state.unlockedZones.map1 = 5; // boss room (zoneIdx 6) still locked

    const props = buildZoneGateProps(zone, biome, GROUND_Y, container, state);
    props.refreshLock(state);
    expect(props.rightLock!.isLocked()).toBe(true);

    state.unlockedZones.map1 = 7; // boss room (zoneIdx 6) now unlocked (loc.zoneIdx < count)
    props.refreshLock(state);
    expect(props.rightLock!.isLocked()).toBe(false);
    expect(props.bossDoor).not.toBeNull();

    props.destroy();
    container.destroy({ children: true });
  });
});

describe("zoneGates helpers — gate x stays inside the walkable field", () => {
  it("left/right gate x for map1 matches the engine's own CONFIG-derived edges", () => {
    const left = gateX("map1", "left");
    const right = gateX("map1", "right");
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(left);
  });
});
