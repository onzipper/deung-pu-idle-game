/**
 * Promoted "โลกมีมิติ" atmosphere runtime (W5) — the day/night + weather +
 * critters controller `GameRenderer` owns alongside the depth/terrain/camera
 * seams from W2-W4. Composes the pure `dayNight`/`weatherSchedule` math with
 * the pooled `weather`/`critters` Pixi layers this module owns exclusively;
 * `GameRenderer` only ever calls the four methods `createAtmosphere` returns.
 *
 * Placement (see the lab-proud-tiger plan §W5 + the owner-approved `/lab`
 * experiment ⑨ §living-world composition this ports):
 *   - weather (`weather.ts`'s `view`, screen-fixed WORLD_WIDTH×WORLD_HEIGHT,
 *     no mask) sits on `hosts.world` directly ABOVE `hosts.cameraRoot` — so it
 *     never pans/zooms with the living camera — and BELOW whatever already
 *     follows `cameraRoot` there (today: the boss-bar `overlay` layer, found
 *     by inserting relative to `cameraRoot`'s OWN index rather than needing an
 *     `overlay` reference of our own — see `hosts`'s doc comment);
 *   - a flat night-tint `Graphics` rect sits directly above the weather view,
 *     still below that same sibling — so boss HP bars never dim at night;
 *   - birds (`critters.birdsView`) join `hosts.background` (top strata within
 *     it — added last, so they draw over scenery — riding the camera pan);
 *   - fireflies (`critters.firefliesView`) are inserted just above
 *     `hosts.entities` INSIDE `cameraRoot` (in front of heroes/enemies, per
 *     `critters.ts`'s own doc comment), reading as ground-level motes in front
 *     of the action.
 *
 * Tinting: `ambientTint` applies to `background`/`ghosts`/`entities` ONLY —
 * never `fx`/`projectiles` (damage numbers and skill fx keep their true colors
 * at night; the night-overlay rect is what unifies the mood instead).
 * `skyTint` is deliberately UNUSED in v1 — there's no dedicated sky container
 * here to tint (flagged in the plan's "known-accepted quirks" for an owner
 * playtest call, not an oversight).
 *
 * OFF-identity: `setEnabled(false)` (the default, applied once even before
 * the first call) freezes everything to today's exact look — weather "none",
 * critters hidden, every tint `0xffffff`, night-overlay alpha 0 — and every
 * subsequent `update()` is a single boolean check, zero further work.
 * `setDensity` is an independent perf valve (GameClient's fps-EMA, W6),
 * layered UNDER `enabled`: 1 = full, 0 = weather/critters/night-overlay
 * hidden AND `update()` skips its whole body (mirrors the disabled path, one
 * idempotency check per frame), else (e.g. 0.5) = weather alpha halved +
 * birds hidden (fireflies stay nightness-gated, already cheap).
 *
 * Zero steady-state allocation: `paletteScratch` is a single out-param object
 * reused every frame (`dayNight.ts`'s documented convention); the
 * zone/window-change gate compares three PRIMITIVES (mapId/zoneIdx/window),
 * never building a hash or a template-string key per frame — `weatherFor`
 * (which internally hashes) only ever runs on an actual zone or window change.
 */

import { Container, Graphics } from "pixi.js";
import type { Zone } from "@/engine";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { createCritters, type Critters } from "./critters";
import { cyclePhase, samplePalette, type DayPalette } from "./dayNight";
import { createWeatherLayer, type WeatherLayer } from "./weather";
import { WEATHER_WINDOW_MS, weatherFor } from "./weatherSchedule";

/** Weather-view opacity while `setDensity` sits strictly between 0 and 1 (the
 * settings wave's fps-valve mid tier) — "rain-half" per the plan. */
const WEATHER_HALF_ALPHA = 0.5;

/**
 * The five layers `GameRenderer` already owns that this module reads/writes.
 * `cameraRoot` and `entities` double as POSITION ANCHORS (see the module doc
 * comment) — both MUST already be attached to their respective parents
 * (`world`, `cameraRoot`) before `createAtmosphere` runs,
 * which `GameRenderer.create()` guarantees by construction order. `fx` /
 * `projectiles` are deliberately NOT part of this shape — this module never
 * touches them (see the tinting note above).
 */
export interface AtmosphereHosts {
  /** Parent of `cameraRoot` — hosts the screen-fixed weather + night overlay. */
  world: Container;
  /** The living-camera content root — hosts the fireflies anchor. */
  cameraRoot: Container;
  /** Scenery layer (bottom of `cameraRoot`) — hosts birds + the ambient tint. */
  background: Container;
  /** Other-player ghosts layer — ambient tint only (no children added here). */
  ghosts: Container;
  /** Heroes/enemies/boss/NPC layer — ambient tint + the fireflies anchor. */
  entities: Container;
}

export interface Atmosphere {
  /** Master on/off (default OFF, applied immediately at construction). false
   * = pixel-identical to today. */
  setEnabled(on: boolean): void;
  /** Perf valve, independent of `setEnabled`: 1 full / 0.5 reduced / 0 hidden
   * (only matters once `setEnabled(true)`). */
  setDensity(s: number): void;
  /** Advance by real-seconds `dt`; `nowMs` is the shared wall clock (the
   * caller's `Date.now()`); `zone` is the current zone, or null. */
  update(dt: number, nowMs: number, zone: Zone | null): void;
  destroy(): void;
}

export function createAtmosphere(hosts: AtmosphereHosts): Atmosphere {
  const weatherLayer: WeatherLayer = createWeatherLayer("none");
  const weatherView = weatherLayer.view;
  const nightOverlay = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0xffffff);

  // Both land directly above `cameraRoot`, in order (weather then the night
  // tint), and therefore below whatever already followed `cameraRoot` there
  // (today: the screen-anchored boss-bar `overlay`, then the camera clip
  // mask) — see the module doc comment for why this needs no `overlay`
  // reference of its own.
  const aboveCamera = hosts.world.getChildIndex(hosts.cameraRoot) + 1;
  hosts.world.addChildAt(weatherView, aboveCamera);
  hosts.world.addChildAt(nightOverlay, aboveCamera + 1);

  const critters: Critters = createCritters(WORLD_WIDTH);
  hosts.background.addChild(critters.birdsView);
  hosts.cameraRoot.addChildAt(
    critters.firefliesView,
    hosts.cameraRoot.getChildIndex(hosts.entities) + 1,
  );

  let enabled = false;
  let density = 1;
  let destroyed = false;
  /** True once a `density<=0` freeze has been applied — `update()` skips its
   * whole body on every subsequent frame until density recovers. */
  let densityFrozen = false;
  /** Zone/window change gate as PRIMITIVE fields (never a per-frame string
   * key) — see the module doc comment's zero-alloc note. */
  let lastZoneMapId: string | null = null;
  let lastZoneIdx: number | null = null;
  let lastWindow = -1;
  /** Reused out-param (`dayNight.ts`'s convention) — the render loop never
   * allocates a fresh `DayPalette` after this one-time construction. */
  const paletteScratch: DayPalette = samplePalette(0);

  /** Snap every owned visual to today's exact flat look. Called once up front
   * (so a freshly-built, never-toggled instance already matches "off"), again
   * on every `setEnabled(false)`, and once on entering a `density<=0` window. */
  function applyFrozen(): void {
    weatherLayer.setKind("none");
    lastZoneMapId = null;
    lastZoneIdx = null;
    lastWindow = -1;
    weatherView.alpha = 1;
    critters.birdsView.visible = false;
    critters.firefliesView.visible = false;
    critters.firefliesView.alpha = 0;
    nightOverlay.tint = 0xffffff;
    nightOverlay.alpha = 0;
    hosts.background.tint = 0xffffff;
    hosts.ghosts.tint = 0xffffff;
    hosts.entities.tint = 0xffffff;
  }
  applyFrozen();

  function setEnabled(on: boolean): void {
    if (destroyed) return;
    enabled = on;
    if (!on) applyFrozen();
  }

  function setDensity(s: number): void {
    if (destroyed) return;
    density = s;
  }

  function update(dt: number, nowMs: number, zone: Zone | null): void {
    if (destroyed || !enabled) return;

    if (density <= 0) {
      if (!densityFrozen) {
        applyFrozen();
        densityFrozen = true;
      }
      return;
    }
    densityFrozen = false;

    // ---- day/night palette (scratch out-param, zero alloc) -----------------
    const palette = samplePalette(cyclePhase(nowMs), paletteScratch);
    hosts.background.tint = palette.ambientTint;
    hosts.ghosts.tint = palette.ambientTint;
    hosts.entities.tint = palette.ambientTint;
    nightOverlay.tint = palette.overlayColor;
    nightOverlay.alpha = palette.overlayAlpha;

    // ---- weather: re-evaluate only on zone change OR a 20-min window edge --
    if (zone) {
      const window = Math.floor(nowMs / WEATHER_WINDOW_MS);
      if (zone.mapId !== lastZoneMapId || zone.zoneIdx !== lastZoneIdx || window !== lastWindow) {
        lastZoneMapId = zone.mapId;
        lastZoneIdx = zone.zoneIdx;
        lastWindow = window;
        weatherLayer.setKind(weatherFor(zone, nowMs));
      }
    } else if (lastZoneMapId !== null || lastZoneIdx !== null) {
      lastZoneMapId = null;
      lastZoneIdx = null;
      lastWindow = -1;
      weatherLayer.setKind("none");
    }
    weatherLayer.update(dt);
    weatherView.alpha = density >= 1 ? 1 : WEATHER_HALF_ALPHA;

    // ---- critters ------------------------------------------------------------
    critters.update(dt, palette.nightness);
    critters.birdsView.visible = density >= 1;
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    weatherLayer.destroy();
    critters.destroy();
    nightOverlay.destroy();
  }

  return { setEnabled, setDensity, update, destroy };
}
