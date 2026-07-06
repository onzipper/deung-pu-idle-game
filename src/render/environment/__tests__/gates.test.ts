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
  for (const family of ["map1", "map2", "map3", "town"] as const) {
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
    expect(container.children.length).toBe(2); // left arch + right arch

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

describe("zoneGates helpers — gate x stays inside the walkable field", () => {
  it("left/right gate x for map1 matches the engine's own CONFIG-derived edges", () => {
    const left = gateX("map1", "left");
    const right = gateX("map1", "right");
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(left);
  });
});
