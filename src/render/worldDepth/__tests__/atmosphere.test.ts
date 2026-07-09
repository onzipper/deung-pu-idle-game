/**
 * Headless correctness guard for W5's atmosphere runtime — same plain-Node
 * Pixi Container/Graphics convention as the sibling `worldDepth` tests (no
 * canvas/WebGL needed for tint/alpha/visible/child-index assertions).
 *
 * `WeatherLayer`/`Critters` expose no "what kind is showing right now"
 * getter, so weather correctness is asserted the same way a PLAYER would
 * observe it: whether any of `weather.view`'s lazily-built sub-pools is
 * currently `visible`. `weatherFor` (the real, deterministic scheduler) is
 * used as an ORACLE to find zone/window combinations that resolve to "none"
 * vs a real kind, rather than hand-rolling a parallel hash.
 */

import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Zone } from "@/engine";
import { createAtmosphere, type AtmosphereHosts } from "@/render/worldDepth/atmosphere";
import { DAY_MS } from "@/render/worldDepth/dayNight";
import { WEATHER_WINDOW_MS, weatherFor } from "@/render/worldDepth/weatherSchedule";
import type { WeatherKind } from "@/render/worldDepth/weather";

// ---------------------------------------------------------------------------
// Fixture — mirrors GameRenderer.create()'s exact composition: cameraRoot
// (holding background/ghosts/entities/projectiles/fx) as world's first
// child, `overlay` and `cameraMask` following it.
// ---------------------------------------------------------------------------
function makeHosts(): {
  hosts: AtmosphereHosts;
  world: Container;
  cameraRoot: Container;
  overlay: Container;
  cameraMask: Graphics;
} {
  const world = new Container();
  const cameraRoot = new Container();
  const background = new Container();
  const ghosts = new Container();
  const entities = new Container();
  const projectiles = new Container();
  const fx = new Container();
  cameraRoot.addChild(background, ghosts, entities, projectiles, fx);
  const overlay = new Container();
  world.addChild(cameraRoot, overlay);
  const cameraMask = new Graphics();
  world.addChild(cameraMask);
  return { hosts: { world, cameraRoot, background, ghosts, entities }, world, cameraRoot, overlay, cameraMask };
}

function weatherViewOf(world: Container, cameraRoot: Container): Container {
  return world.children[world.getChildIndex(cameraRoot) + 1] as Container;
}

function nightOverlayOf(world: Container, cameraRoot: Container): Graphics {
  return world.children[world.getChildIndex(cameraRoot) + 2] as Graphics;
}

function firefliesViewOf(cameraRoot: Container, entities: Container): Container {
  return cameraRoot.children[cameraRoot.getChildIndex(entities) + 1] as Container;
}

function anyVisibleChild(c: Container): boolean {
  return c.children.some((child) => child.visible);
}

const NIGHT_MS = 0.75 * DAY_MS; // exact keyframe hit: nightness=1, overlayAlpha=max
const NO_WEATHER_ZONE: Zone = { mapId: "map2", zoneIdx: 1, kind: "farm", stage: 1 }; // ALLOWED_BY_MAP.map2 = [] → always "none"
const RAIN_ZONE: Zone = { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 }; // allows rain/leaves

/** First window index (from 0) whose `weatherFor(zone, ·)` kind is/isn't "none". */
function findWindow(zone: Zone, wantNone: boolean, maxWindow = 400): number {
  for (let w = 0; w < maxWindow; w++) {
    const kind: WeatherKind = weatherFor(zone, w * WEATHER_WINDOW_MS + 1);
    if (wantNone === (kind === "none")) return w;
  }
  throw new Error("no matching window found — weatherSchedule's tables may have changed");
}

// ---------------------------------------------------------------------------

describe("atmosphere — layer composition", () => {
  it("weather view + night overlay insert directly above cameraRoot, below the pre-existing overlay/mask", () => {
    const { hosts, world, cameraRoot, overlay, cameraMask } = makeHosts();
    createAtmosphere(hosts);

    const rootIdx = world.getChildIndex(cameraRoot);
    expect(world.children.length).toBe(5); // cameraRoot, weatherView, nightOverlay, overlay, cameraMask
    expect(world.getChildIndex(overlay)).toBe(rootIdx + 3);
    expect(world.getChildIndex(cameraMask)).toBe(rootIdx + 4);
  });

  it("birds join background (only child); fireflies insert directly above entities inside cameraRoot", () => {
    const { hosts, cameraRoot } = makeHosts();
    createAtmosphere(hosts);

    expect(hosts.background.children.length).toBe(1);
    expect(cameraRoot.children.length).toBe(6); // background, ghosts, entities, fireflies, projectiles, fx
    const entitiesIdx = cameraRoot.getChildIndex(hosts.entities);
    const sibling = cameraRoot.children[entitiesIdx + 1];
    expect(sibling).toBeDefined();
    expect(sibling).not.toBe(hosts.ghosts);
  });
});

describe("atmosphere — OFF (default) is pixel-identical to today", () => {
  it("a never-enabled instance starts frozen: white tints, invisible overlay, no visible weather", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);

    atmosphere.update(1 / 60, NIGHT_MS, RAIN_ZONE); // even fed a "should be lively" frame

    expect(hosts.background.tint).toBe(0xffffff);
    expect(hosts.ghosts.tint).toBe(0xffffff);
    expect(hosts.entities.tint).toBe(0xffffff);
    expect(nightOverlayOf(world, cameraRoot).alpha).toBe(0);
    expect(anyVisibleChild(weatherViewOf(world, cameraRoot))).toBe(false);
    expect(firefliesViewOf(cameraRoot, hosts.entities).visible).toBe(false);

    atmosphere.destroy();
  });

  it("toggling ON then back OFF resets every tint/overlay/weather cue (not just Pixi defaults)", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    const w = findWindow(RAIN_ZONE, false);
    atmosphere.update(1 / 60, NIGHT_MS + w * WEATHER_WINDOW_MS, RAIN_ZONE);
    // Sanity: it actually changed something before we flip back off.
    expect(hosts.entities.tint).toBeLessThan(0xffffff);

    atmosphere.setEnabled(false);

    expect(hosts.background.tint).toBe(0xffffff);
    expect(hosts.entities.tint).toBe(0xffffff);
    expect(nightOverlayOf(world, cameraRoot).alpha).toBe(0);
    expect(anyVisibleChild(weatherViewOf(world, cameraRoot))).toBe(false);

    atmosphere.destroy();
  });
});

describe("atmosphere — ON at a night nowMs", () => {
  it("overlay alpha > 0, ambient tints darken, fireflies alpha follows nightness", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);

    atmosphere.update(1 / 60, NIGHT_MS, NO_WEATHER_ZONE);

    expect(hosts.background.tint).toBeLessThan(0xffffff);
    expect(hosts.ghosts.tint).toBeLessThan(0xffffff);
    expect(hosts.entities.tint).toBeLessThan(0xffffff);
    // Actor readability relief: entities are tinted LESS than the moody
    // backdrop/ghosts (see entityAmbientTint) so mobs/HP bars stay legible.
    expect(hosts.entities.tint).toBeGreaterThan(hosts.background.tint);
    expect(hosts.entities.tint).toBeGreaterThan(hosts.ghosts.tint);
    expect(nightOverlayOf(world, cameraRoot).alpha).toBeGreaterThan(0);
    // t=0.75 is the exact "กลางคืน" keyframe: nightness=1.
    expect(firefliesViewOf(cameraRoot, hosts.entities).alpha).toBeCloseTo(1, 5);
    expect(firefliesViewOf(cameraRoot, hosts.entities).visible).toBe(true);

    atmosphere.destroy();
  });

  it("at noon (t=0.25) tints/overlay/fireflies sit at the neutral 'off-identical' baseline", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);

    atmosphere.update(1 / 60, 0.25 * DAY_MS, NO_WEATHER_ZONE);

    expect(hosts.entities.tint).toBe(0xffffff);
    expect(nightOverlayOf(world, cameraRoot).alpha).toBe(0);
    expect(firefliesViewOf(cameraRoot, hosts.entities).alpha).toBeCloseTo(0, 5);

    atmosphere.destroy();
  });
});

describe("atmosphere — weather responds to zone/window changes, not every update", () => {
  it("stays stable within a window, swaps only at a window/zone boundary", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    const weatherView = weatherViewOf(world, cameraRoot);

    const liveWindow = findWindow(RAIN_ZONE, false);
    const clearWindow = findWindow(RAIN_ZONE, true);
    expect(liveWindow).not.toBe(clearWindow);

    // Early in the live window: weather shows.
    atmosphere.update(1 / 60, liveWindow * WEATHER_WINDOW_MS + 5, RAIN_ZONE);
    expect(anyVisibleChild(weatherView)).toBe(true);

    // Many more frames, still the SAME window: stays visible (no thrash/clear).
    for (let i = 0; i < 20; i++) {
      atmosphere.update(1 / 60, liveWindow * WEATHER_WINDOW_MS + 100 + i * 500, RAIN_ZONE);
    }
    expect(anyVisibleChild(weatherView)).toBe(true);

    // Cross into a window whose weather is "none": clears.
    atmosphere.update(1 / 60, clearWindow * WEATHER_WINDOW_MS + 5, RAIN_ZONE);
    expect(anyVisibleChild(weatherView)).toBe(false);

    atmosphere.destroy();
  });

  it("a null zone forces weather to none and is remembered until a real zone returns", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    const weatherView = weatherViewOf(world, cameraRoot);

    const liveWindow = findWindow(RAIN_ZONE, false);
    const nowMs = liveWindow * WEATHER_WINDOW_MS + 5;
    atmosphere.update(1 / 60, nowMs, RAIN_ZONE);
    expect(anyVisibleChild(weatherView)).toBe(true);

    atmosphere.update(1 / 60, nowMs, null);
    expect(anyVisibleChild(weatherView)).toBe(false);

    atmosphere.update(1 / 60, nowMs, RAIN_ZONE);
    expect(anyVisibleChild(weatherView)).toBe(true);

    atmosphere.destroy();
  });
});

describe("atmosphere — setDensity valve", () => {
  it("density 0 hides weather/critters/night-overlay even while enabled, at a lively night moment", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    atmosphere.setDensity(0);

    const w = findWindow(RAIN_ZONE, false);
    atmosphere.update(1 / 60, NIGHT_MS + w * WEATHER_WINDOW_MS, RAIN_ZONE);

    expect(anyVisibleChild(weatherViewOf(world, cameraRoot))).toBe(false);
    expect(firefliesViewOf(cameraRoot, hosts.entities).visible).toBe(false);
    expect(hosts.background.children[0]!.visible).toBe(false); // birds
    expect(nightOverlayOf(world, cameraRoot).alpha).toBe(0);

    atmosphere.destroy();
  });

  it("density 0.5 dims weather to half alpha and hides birds, without hiding fireflies", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    atmosphere.setDensity(0.5);

    const w = findWindow(RAIN_ZONE, false);
    atmosphere.update(1 / 60, NIGHT_MS + w * WEATHER_WINDOW_MS, RAIN_ZONE);

    const weatherView = weatherViewOf(world, cameraRoot);
    expect(anyVisibleChild(weatherView)).toBe(true);
    expect(weatherView.alpha).toBeCloseTo(0.5);
    expect(hosts.background.children[0]!.visible).toBe(false); // birds hidden
    expect(firefliesViewOf(cameraRoot, hosts.entities).visible).toBe(true); // unaffected

    atmosphere.destroy();
  });

  it("density back to 1 restores full weather alpha and birds", () => {
    const { hosts, world, cameraRoot } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    atmosphere.setDensity(0.5);
    const w = findWindow(RAIN_ZONE, false);
    atmosphere.update(1 / 60, w * WEATHER_WINDOW_MS + 5, RAIN_ZONE);

    atmosphere.setDensity(1);
    atmosphere.update(1 / 60, w * WEATHER_WINDOW_MS + 10, RAIN_ZONE);

    expect(weatherViewOf(world, cameraRoot).alpha).toBe(1);
    expect(hosts.background.children[0]!.visible).toBe(true);

    atmosphere.destroy();
  });
});

describe("atmosphere — destroy", () => {
  it("is idempotent and leaves every method safely callable afterward", () => {
    const { hosts } = makeHosts();
    const atmosphere = createAtmosphere(hosts);
    atmosphere.setEnabled(true);
    atmosphere.update(1 / 60, NIGHT_MS, RAIN_ZONE);

    expect(() => {
      atmosphere.destroy();
      atmosphere.destroy();
      atmosphere.update(1 / 60, NIGHT_MS, RAIN_ZONE);
      atmosphere.setEnabled(true);
      atmosphere.setEnabled(false);
      atmosphere.setDensity(0.5);
    }).not.toThrow();
  });
});
