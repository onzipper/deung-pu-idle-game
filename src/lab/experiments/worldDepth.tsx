"use client";

/**
 * Experiment ⑨ — โลกมีมิติ (worldDepth). Lets the owner FEEL four render-only
 * world-depth ideas (plan `lab-proud-tiger`) before any of them is promoted
 * into the real game, each independently toggleable + one master A/B button
 * ("ทั้งหมดเปิด" vs "แบบเดิมแบน" = today's flat one-screen look):
 *
 *   ① สนามลึก   — actors carry a fixed depth d∈[0,1]: y-offset + scale +
 *                  zIndex from `worldDepth/depthBand` on a sortable layer.
 *   ② กล้องมีชีวิต — 2.75×-screen world panned by `worldDepth/camera`
 *                  (follow + lookahead + idle zoom-out + punch), strata pan at
 *                  different factors (0.3/0.55/1/1.15) for parallax.
 *   ③ พื้นไม่เรียบ — cosmetic heightmap `worldDepth/terrain`: the ground
 *                  polygon is traced from `polyline()`, prop chunks + actor
 *                  feet ride `groundY(x)`.
 *   ④ โลกมีชีวิต — `worldDepth/dayNight` palette cycle (sky/ambient tint +
 *                  night overlay), `worldDepth/weather` (rain/snow/ash/leaves,
 *                  screen-fixed), `worldDepth/critters` (birds + night
 *                  fireflies).
 *
 * Scene-graph contract notes (hard-won, see the plan):
 *   - `stage.world` has NO mask, so this experiment's root masks ITSELF to
 *     WORLD_WIDTH×WORLD_HEIGHT — a panning 2475px world would otherwise paint
 *     over the letterbox bars.
 *   - `updateHeroView`/`updateEnemyView` overwrite the view ROOT's position
 *     every frame (`position.set(x, 0)`), so depth/terrain y, depth scale and
 *     zIndex are applied AFTER each update call, every frame. Both rigs flip
 *     via CHILD transforms (bodyRoot/body/legs), never root scale, so a root
 *     `scale.set(depthScale)` cannot clobber facing.
 *   - Rig content anchors its FEET at root-local y ≈ GROUND_Y (heroView's
 *     FEET_Y, enemyView's body pivot), so scaling the root from its default
 *     origin would displace feet by GROUND_Y·(scale−1) — far actors would
 *     float, near ones sink through the mask bottom. Every actor root is
 *     therefore pivoted at the feet line once at creation
 *     (`pivot.y = GROUND_Y`) and the per-frame y is the ABSOLUTE feet
 *     position `groundY(x) + depthOffset`, which holds at any depth scale.
 *   - Chunk/silhouette builders use Math.random at BUILD time → they are
 *     (re)built only on zone/terrain-preset change (burst alloc on a click is
 *     fine); the per-frame path allocates nothing (`cameraTransform` /
 *     `samplePalette` write into cached out-param scratch objects).
 */

import { useMemo, useState } from "react";
import { Container, Graphics } from "pixi.js";
import type { Enemy, EnemyKind, Zone } from "@/engine";
import { biomeForZone, type ResolvedBiome } from "@/render/environment/biomes";
import { adjustLightness } from "@/render/environment/colorUtils";
import { buildGroundPropsChunk } from "@/render/environment/groundProps";
import { buildSilhouetteChunk } from "@/render/environment/silhouettes";
import { buildHorizonGlow, buildSkyBands } from "@/render/environment/sky";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { safeRadius } from "@/render/theme";
import {
  createHeroView,
  updateHeroView,
  type HeroFrameContext,
  type HeroRenderModel,
  type HeroView,
} from "@/render/views/heroView";
import {
  createEnemyView,
  updateEnemyView,
  type EnemyFrameContext,
  type EnemyView,
} from "@/render/views/enemyView";
import type { LabStage } from "@/lab/stage";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { listZoneOptions, zoneLabel } from "@/lab/zones";
import {
  cameraTransform,
  createCamera,
  punchZoom as kickPunchZoom,
  updateCamera,
  type CameraTarget,
  type CameraTransform,
} from "@/lab/worldDepth/camera";
import { samplePalette, type DayPalette } from "@/lab/worldDepth/dayNight";
import { depthOffsetY, depthScale, depthZIndex } from "@/lab/worldDepth/depthBand";
import {
  createTerrain,
  TERRAIN_PRESETS,
  type Terrain,
  type TerrainPresetId,
} from "@/lab/worldDepth/terrain";
import {
  createWeatherLayer,
  WEATHER_OPTIONS,
  type WeatherKind,
  type WeatherLayer,
} from "@/lab/worldDepth/weather";
import { createCritters, type Critters } from "@/lab/worldDepth/critters";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Demo world width — wide enough that the living camera has somewhere to go. */
const WORLD_W = WORLD_WIDTH * 2.75;

/** Parallax pan factors per stratum (layer.x = cam.x * (1 - factor)). */
const FAR_FACTOR = 0.3;
const MID_FACTOR = 0.55;
const FG_FACTOR = 1.15;

/** Silhouette baselines: far ridge raised toward the horizon, mid at the
 * real game's own silhouette line (`BiomeScene` uses GROUND_Y - 2). */
const FAR_BASELINE_Y = GROUND_Y - 28;
const MID_BASELINE_Y = GROUND_Y - 2;
/** Mid silhouettes darken vs the biome's far color — closer = more contrast. */
const MID_DARKEN = -0.15;

/** Chunk widths: silhouettes follow BiomeScene's 180, props per the plan 128. */
const SIL_CHUNK_W = 180;
const PROP_CHUNK_W = 128;
const FG_CHUNK_W = 256;

/** Sideways coverage pad per panned stratum — must exceed the worst-case
 * half-view (WORLD_WIDTH / (2 * idleZoom 0.92) ≈ 489). */
const STRATUM_PAD = WORLD_WIDTH * 0.6;

/** Ground polygon sampling step + how far it extends below the view bottom
 * (the idle zoom-out shifts content down ~15px — never show a gap). */
const GROUND_POLY_STEP = 24;
const GROUND_BOTTOM_EXTEND = 60;
const GROUND_BAND_H = 5;

/** Day length at 1× slider, seconds. Cycle starts frozen-noon-compatible. */
const DAY_LENGTH_S = 60;
const NOON_T = 0.25;

/** Actors. */
const MOB_COUNT = 14;
const HERO_DEPTH = 0.65;
const HERO_SPEED = 70;
const ENGAGE_RANGE = 60;
const SWING_PERIOD = 0.9;
/** Keep actors clear of the world/screen edges (mirrors the game's field). */
const ACTOR_MARGIN = 70;

const MOB_KINDS: readonly EnemyKind[] = [
  "normal", "fast", "ranged", "normal", "tank", "fast", "normal",
  "ranged", "tank", "normal", "fast", "normal", "ranged", "normal",
];
/** Hero waypoint sequence as window fractions + pause lengths (1–2s). */
const WAYPOINT_FRACS = [0.12, 0.82, 0.4, 0.95, 0.6, 0.05, 0.72, 0.28] as const;
const WAYPOINT_PAUSES = [1.0, 1.7, 1.3, 2.0] as const;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

interface ActorWindow {
  min: number;
  max: number;
}

/** Full-world roaming window (camera ON). */
const WIN_WIDE: ActorWindow = { min: ACTOR_MARGIN, max: WORLD_W - ACTOR_MARGIN };
/** Single-screen window (camera OFF pins an identity view of [0, WORLD_WIDTH]
 * — "แบบเดิม" must truly look like today's flat one-screen game). */
const WIN_FLAT: ActorWindow = { min: ACTOR_MARGIN, max: WORLD_WIDTH - ACTOR_MARGIN };

/** Layer-local coverage a stratum panned at `factor` must fill so the camera
 * never sees past its ends (visible local window = f·camX ± halfView). */
function stratumCoverage(factor: number): { start: number; end: number } {
  return { start: -STRATUM_PAD, end: factor * WORLD_W + STRATUM_PAD };
}

function destroyChildren(c: Container): void {
  const removed = c.removeChildren();
  for (let i = 0; i < removed.length; i++) removed[i]!.destroy({ children: true });
}

/** Fill `layer` with seamless silhouette chunks for one stratum. */
function fillSilhouettes(
  layer: Container,
  far: ResolvedBiome["far"],
  baselineY: number,
  factor: number,
): void {
  const cov = stratumCoverage(factor);
  const count = Math.ceil((cov.end - cov.start) / SIL_CHUNK_W);
  for (let i = 0; i < count; i++) {
    const g = buildSilhouetteChunk({
      chunkWidth: SIL_CHUNK_W,
      index: i,
      baselineY,
      shape: far.shape,
      far,
    });
    g.position.x = cov.start + i * SIL_CHUNK_W;
    layer.addChild(g);
  }
}

/** One foreground occluder chunk: 2 big dark rocks + a bush blob hugging the
 * bottom edge — flat fills, radii via `safeRadius` (footguns 3/10). */
function buildForegroundChunk(biome: ResolvedBiome): Graphics {
  const g = new Graphics();
  const rockColor = adjustLightness(biome.ground.base, -0.18);
  const bushColor = adjustLightness(biome.ground.accent, -0.35);
  const baseY = WORLD_HEIGHT + 14;
  for (let k = 0; k < 2; k++) {
    const x = Math.random() * FG_CHUNK_W;
    const w = 60 + Math.random() * 70;
    const h = 26 + Math.random() * 18;
    g.poly(
      [x - w / 2, baseY, x - w * 0.3, baseY - h, x + w * 0.15, baseY - h * 0.8, x + w / 2, baseY],
      true,
    ).fill({ color: rockColor, alpha: 0.95 });
  }
  const bx = Math.random() * FG_CHUNK_W;
  g.circle(bx, baseY - 16, safeRadius(14)).fill({ color: bushColor, alpha: 0.9 });
  g.circle(bx + 14, baseY - 10, safeRadius(10)).fill({ color: bushColor, alpha: 0.85 });
  return g;
}

/** Redraw the ground polygon in place: biome base fill traced from the
 * terrain polyline (or a flat rect when terrain is off) + a thin re-traced
 * top band strip, closed down past the view bottom. Burst alloc — called only
 * on zone/preset/toggle change, never per frame. */
function redrawGroundPoly(
  g: Graphics,
  biome: ResolvedBiome,
  terrain: Terrain,
  terrainOn: boolean,
): void {
  g.clear();
  const bottom = WORLD_HEIGHT + GROUND_BOTTOM_EXTEND;
  if (!terrainOn) {
    g.rect(0, GROUND_Y, WORLD_W, bottom - GROUND_Y).fill(biome.ground.base);
    g.rect(0, GROUND_Y, WORLD_W, GROUND_BAND_H).fill(biome.ground.band);
    return;
  }
  const pts = terrain.polyline(GROUND_POLY_STEP);
  const basePoly: number[] = [];
  for (let i = 0; i < pts.length; i += 2) basePoly.push(pts[i]!, pts[i + 1]!);
  basePoly.push(WORLD_W, bottom, 0, bottom);
  g.poly(basePoly, true).fill(biome.ground.base);
  // Top band strip: forward trace + reversed trace shifted down GROUND_BAND_H.
  const band: number[] = [];
  for (let i = 0; i < pts.length; i += 2) band.push(pts[i]!, pts[i + 1]!);
  for (let i = pts.length - 2; i >= 0; i -= 2) band.push(pts[i]!, pts[i + 1]! + GROUND_BAND_H);
  g.poly(band, true).fill(biome.ground.band);
}

/** Enemy stub — shape copied from experiment ③ (`sideBySide.tsx`). */
function makeEnemyStub(id: number, kind: EnemyKind, x: number): Enemy {
  return {
    id,
    kind,
    x,
    y: 0,
    hp: 80,
    maxHp: 80,
    atk: 10,
    speed: 60,
    size: 1,
    behavior: kind === "ranged" ? "ranged" : "melee",
    range: kind === "ranged" ? 220 : 0,
    cd: 0,
    engageOffset: 0,
    homeX: x,
    aggressive: false,
    aggroRadius: 0,
    engaged: false,
  };
}

interface MobActor {
  stub: Enemy;
  view: EnemyView;
  /** Fixed position within the actor window, 0..1 — survives window swaps. */
  homeFrac: number;
  homeX: number;
  /** Home-wander sine params (deterministic per index — no per-frame random). */
  wanderAmp: number;
  wanderW: number;
  phase: number;
  /** Depth band coordinate (fixed) + its precomputed render mapping. */
  d: number;
  depthOffY: number;
  depthScl: number;
  depthZ: number;
  /** Flat-mode zIndex = insertion order (stable "today's game" layering). */
  insertion: number;
}

// ---------------------------------------------------------------------------
// Controls bag
// ---------------------------------------------------------------------------

interface ControlsBag {
  zones: Zone[];
  getZoneIndex(): number;
  setZoneIndex(i: number): void;
  getMaster(): boolean;
  setMaster(v: boolean): void;
  getDepth(): boolean;
  setDepth(v: boolean): void;
  getCamera(): boolean;
  setCamera(v: boolean): void;
  getTerrain(): boolean;
  setTerrain(v: boolean): void;
  getLiving(): boolean;
  setLiving(v: boolean): void;
  getWeather(): WeatherKind;
  setWeather(k: WeatherKind): void;
  getCycleSpeed(): number;
  setCycleSpeed(v: number): void;
  getTerrainPreset(): TerrainPresetId;
  setTerrainPreset(p: TerrainPresetId): void;
  punchZoom(): void;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function createScene(stage: LabStage, _frames: FrameSet): LabScene {
  void _frames; // this experiment renders real rigs + code scenery, no uploads

  // ---- root, self-masked to the letterboxed logical screen ----------------
  const view = new Container();
  const maskG = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0xffffff);
  view.mask = maskG;

  const skyLayer = new Container(); // screen-fixed, children rebuilt per zone
  const cameraRoot = new Container();

  const farLayer = new Container();
  const farChunksC = new Container();
  const midLayer = new Container();
  const midChunksC = new Container();
  const groundStratum = new Container(); // pan factor 1 — x stays 0
  const groundPoly = new Graphics();
  const propsLayer = new Container();
  propsLayer.position.set(0, GROUND_Y); // chunk-local y=0 = flat band top (BiomeScene idiom)
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  const fgLayer = new Container();
  const fgChunksC = new Container();

  const critters: Critters = createCritters(WORLD_W);
  critters.birdsView.position.x = -STRATUM_PAD; // extend into the far stratum's left pad
  const weather: WeatherLayer = createWeatherLayer("none");

  const overlay = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0xffffff);
  overlay.alpha = 0;

  farLayer.addChild(farChunksC, critters.birdsView);
  midLayer.addChild(midChunksC);
  groundStratum.addChild(groundPoly, propsLayer, entityLayer, critters.firefliesView);
  fgLayer.addChild(fgChunksC);
  cameraRoot.addChild(farLayer, midLayer, groundStratum, fgLayer);
  view.addChild(skyLayer, cameraRoot, weather.view, overlay, maskG);
  stage.world.addChild(view);

  // ---- feature state -------------------------------------------------------
  let disposed = false;
  let depthOn = true;
  let cameraOn = true;
  let terrainOn = true;
  let livingOn = true;
  let terrainPreset: TerrainPresetId = "hills";
  let weatherKind: WeatherKind = "none";
  let cycleSpeed = 1;
  let dayT = NOON_T;
  const noonPalette: DayPalette = samplePalette(NOON_T); // frozen "living off" frame
  // Per-frame out-param scratch objects — mutated in place, never re-allocated
  // (noonPalette above deliberately stays a SEPARATE frozen object).
  const paletteScratch: DayPalette = samplePalette(NOON_T);

  let terrain: Terrain = createTerrain(terrainPreset, WORLD_W);
  const cam = createCamera(WORLD_W);
  const camTarget: CameraTarget = { x: WORLD_W / 2, vx: 0 };
  const ctScratch: CameraTransform = cameraTransform(cam);

  // ---- zone / biome ---------------------------------------------------------
  const zones = listZoneOptions();
  let zoneIdx = Math.min(1, zones.length - 1); // first farm zone reads best
  let biome: ResolvedBiome = biomeForZone(zones[zoneIdx]!);

  // ---- actors ---------------------------------------------------------------
  const fakeHero: HeroRenderModel = {
    cls: "swordsman",
    x: WORLD_W / 2,
    aimX: null,
    equipped: { weapon: null, armor: null },
    tier: 1,
    shadowed: false,
    cd: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    reviveTimer: 0,
  };
  const heroView: HeroView = createHeroView();
  // Feet-line pivot: depthScale must grow/shrink the rig AROUND its feet
  // (rig feet sit at root-local y ≈ GROUND_Y — see the module doc comment).
  heroView.pivot.y = GROUND_Y;
  entityLayer.addChild(heroView);
  const heroDepthOffY = depthOffsetY(HERO_DEPTH);
  const heroDepthScl = depthScale(HERO_DEPTH);
  const heroDepthZ = depthZIndex(HERO_DEPTH);
  const HERO_INSERTION = MOB_COUNT; // hero draws over mobs in flat mode

  const mobs: MobActor[] = [];
  for (let i = 0; i < MOB_COUNT; i++) {
    const d = ((i * 5) % MOB_COUNT) / (MOB_COUNT - 1); // shuffled full spread over [0,1]
    const mobView = createEnemyView();
    mobView.pivot.y = GROUND_Y; // feet-line pivot, same as the hero
    const mob: MobActor = {
      stub: makeEnemyStub(i + 1, MOB_KINDS[i % MOB_KINDS.length]!, 0),
      view: mobView,
      homeFrac: (i + 0.5) / MOB_COUNT,
      homeX: 0,
      wanderAmp: 22 + (i % 3) * 6,
      wanderW: 0.22 + ((i * 3) % 5) * 0.07,
      phase: i * 1.9,
      d,
      depthOffY: depthOffsetY(d),
      depthScl: depthScale(d),
      depthZ: depthZIndex(d),
      insertion: i,
    };
    entityLayer.addChild(mob.view);
    mobs.push(mob);
  }

  // Hero waypoint walker state.
  let wpIdx = 0;
  let pauseIdx = 0;
  let heroTargetX = fakeHero.x;
  let pauseT = 0;
  let swingAccum = 0;
  let t = 0;

  // Cached per-frame contexts — mutated in place, never re-allocated.
  const heroCtx: HeroFrameContext = { dt: 0, slot: 0, events: [], marching: false };
  const enemyCtx: EnemyFrameContext = { dt: 0, events: [], mapId: zones[zoneIdx]!.mapId };

  function currentWindow(): ActorWindow {
    return cameraOn ? WIN_WIDE : WIN_FLAT;
  }

  /** Re-seat every actor inside the active window (camera toggle / master). */
  function applyActorWindow(): void {
    const win = currentWindow();
    const span = win.max - win.min;
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i]!;
      m.homeX = win.min + m.homeFrac * span;
      m.stub.homeX = m.homeX;
    }
    fakeHero.x = Math.min(win.max, Math.max(win.min, fakeHero.x));
    heroTargetX = win.min + WAYPOINT_FRACS[wpIdx % WAYPOINT_FRACS.length]! * span;
  }

  function placePropChunks(): void {
    const chunks = propsLayer.children;
    for (let i = 0; i < chunks.length; i++) {
      const centerX = i * PROP_CHUNK_W + PROP_CHUNK_W / 2;
      chunks[i]!.position.y = terrainOn ? terrain.groundY(centerX) - GROUND_Y : 0;
    }
  }

  /** Rebuild everything biome-colored (zone change) — burst alloc by design. */
  function rebuildScenery(): void {
    destroyChildren(skyLayer);
    skyLayer.addChild(
      buildSkyBands(biome.sky.top, biome.sky.bottom, 0, 0, WORLD_WIDTH, WORLD_HEIGHT),
      buildHorizonGlow(biome.sky.horizon, 0, WORLD_WIDTH, GROUND_Y),
    );

    destroyChildren(farChunksC);
    fillSilhouettes(farChunksC, biome.far, FAR_BASELINE_Y, FAR_FACTOR);
    destroyChildren(midChunksC);
    fillSilhouettes(
      midChunksC,
      { ...biome.far, color: adjustLightness(biome.far.color, MID_DARKEN) },
      MID_BASELINE_Y,
      MID_FACTOR,
    );

    redrawGroundPoly(groundPoly, biome, terrain, terrainOn);
    destroyChildren(propsLayer);
    const propCount = Math.ceil(WORLD_W / PROP_CHUNK_W);
    for (let i = 0; i < propCount; i++) {
      const g = buildGroundPropsChunk({
        chunkWidth: PROP_CHUNK_W,
        bandDepth: WORLD_HEIGHT - GROUND_Y + GROUND_BOTTOM_EXTEND,
        biome,
      });
      g.position.x = i * PROP_CHUNK_W;
      propsLayer.addChild(g);
    }
    placePropChunks();

    destroyChildren(fgChunksC);
    const fgCov = stratumCoverage(FG_FACTOR);
    const fgCount = Math.ceil((fgCov.end - fgCov.start) / FG_CHUNK_W);
    for (let i = 0; i < fgCount; i++) {
      const g = buildForegroundChunk(biome);
      g.position.x = fgCov.start + i * FG_CHUNK_W;
      fgChunksC.addChild(g);
    }
  }

  /** New zone = new map species — swap stubs AND views so `buildRig` re-runs
   * with the new `mapId` (rig only rebuilds on kind change otherwise). */
  function rebuildEnemyViews(): void {
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i]!;
      m.view.destroy({ children: true });
      m.stub = makeEnemyStub(i + 1, MOB_KINDS[i % MOB_KINDS.length]!, m.homeX);
      m.view = createEnemyView();
      m.view.pivot.y = GROUND_Y; // feet-line pivot, same as at first creation
      entityLayer.addChild(m.view);
    }
  }

  function mountZone(i: number): void {
    zoneIdx = Math.max(0, Math.min(zones.length - 1, i));
    const zone = zones[zoneIdx]!;
    biome = biomeForZone(zone);
    enemyCtx.mapId = zone.mapId;
    rebuildScenery();
    rebuildEnemyViews();
  }

  // ---- feature toggles ------------------------------------------------------
  function setDepth(v: boolean): void {
    depthOn = v; // pure per-frame mapping — nothing to rebuild
  }

  function setCameraOn(v: boolean): void {
    cameraOn = v;
    if (!v) {
      // Pin an identity view of the single central screen: cam.x at
      // WORLD_WIDTH/2 with zoom 1 makes cameraTransform() the identity.
      cam.x = WORLD_WIDTH / 2;
      cam.zoom = 1;
      cam.zoomBase = 1;
      cam.lookahead = 0;
      cam.idleT = 0;
      cam.punch = 0;
    }
    applyActorWindow();
  }

  function setTerrainOn(v: boolean): void {
    terrainOn = v;
    redrawGroundPoly(groundPoly, biome, terrain, terrainOn);
    placePropChunks();
  }

  function setTerrainPreset(p: TerrainPresetId): void {
    terrainPreset = p;
    terrain = createTerrain(p, WORLD_W);
    redrawGroundPoly(groundPoly, biome, terrain, terrainOn);
    placePropChunks();
  }

  function setLiving(v: boolean): void {
    livingOn = v;
    weather.setKind(v ? weatherKind : "none");
    critters.birdsView.visible = v;
    if (!v) critters.firefliesView.visible = false; // re-shown by critters.update at night
  }

  function setWeatherKind(k: WeatherKind): void {
    weatherKind = k;
    if (livingOn) weather.setKind(k);
  }

  const controls: ControlsBag = {
    zones,
    getZoneIndex: () => zoneIdx,
    setZoneIndex: (i) => mountZone(i),
    getMaster: () => depthOn && cameraOn && terrainOn && livingOn,
    setMaster(v) {
      setDepth(v);
      setCameraOn(v);
      setTerrainOn(v);
      setLiving(v);
    },
    getDepth: () => depthOn,
    setDepth,
    getCamera: () => cameraOn,
    setCamera: setCameraOn,
    getTerrain: () => terrainOn,
    setTerrain: setTerrainOn,
    getLiving: () => livingOn,
    setLiving,
    getWeather: () => weatherKind,
    setWeather: setWeatherKind,
    getCycleSpeed: () => cycleSpeed,
    setCycleSpeed(v) {
      cycleSpeed = Math.max(0, Math.min(8, v));
    },
    getTerrainPreset: () => terrainPreset,
    setTerrainPreset,
    punchZoom() {
      if (cameraOn) kickPunchZoom(cam);
    },
  };

  // First build.
  mountZone(zoneIdx);
  applyActorWindow();

  // ---------------------------------------------------------------------------
  // Per-frame update — zero steady-state allocation: cameraTransform /
  // samplePalette write into the cached scratch objects above, and no
  // builder/array helper runs outside the zone/preset rebuild paths.
  // ---------------------------------------------------------------------------
  return {
    view,
    update(dt) {
      if (disposed) return;
      t += dt;

      // ---- day/night palette ------------------------------------------------
      let palette: DayPalette;
      if (livingOn) {
        dayT += (dt * cycleSpeed) / DAY_LENGTH_S;
        palette = samplePalette(dayT, paletteScratch); // out-param, zero alloc
      } else {
        palette = noonPalette;
      }
      skyLayer.tint = palette.skyTint;
      cameraRoot.tint = palette.ambientTint;
      overlay.tint = palette.overlayColor;
      overlay.alpha = palette.overlayAlpha;

      // ---- hero: waypoint walker + engage-nearby-mob swings -----------------
      const win = currentWindow();
      let vx = 0;
      if (pauseT > 0) {
        pauseT -= dt;
        if (pauseT <= 0) {
          wpIdx = (wpIdx + 1) % WAYPOINT_FRACS.length;
          heroTargetX = win.min + WAYPOINT_FRACS[wpIdx]! * (win.max - win.min);
        }
      } else {
        const dx = heroTargetX - fakeHero.x;
        const step = HERO_SPEED * dt;
        if (Math.abs(dx) <= step) {
          fakeHero.x = heroTargetX;
          pauseIdx = (pauseIdx + 1) % WAYPOINT_PAUSES.length;
          pauseT = WAYPOINT_PAUSES[pauseIdx]!;
        } else {
          const dir = dx > 0 ? 1 : -1;
          fakeHero.x += dir * step;
          vx = dir * HERO_SPEED;
        }
      }

      let nearestIdx = -1;
      let nearestDist = ENGAGE_RANGE;
      for (let i = 0; i < mobs.length; i++) {
        const dist = Math.abs(mobs[i]!.stub.x - fakeHero.x);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
      if (nearestIdx >= 0) {
        fakeHero.aimX = mobs[nearestIdx]!.stub.x;
        swingAccum += dt;
        if (swingAccum >= SWING_PERIOD) {
          swingAccum -= SWING_PERIOD;
          fakeHero.cd += 1; // cd-bump swing idiom (experiment ⑦)
        }
      } else {
        fakeHero.aimX = null;
        swingAccum = 0;
      }
      fakeHero.cd = Math.max(0, fakeHero.cd - dt);

      heroCtx.dt = dt;
      updateHeroView(heroView, fakeHero, heroCtx);
      // Root position was just overwritten by the update (position.set(x, 0))
      // — apply depth/terrain AFTER, every frame. The root is pivoted at the
      // feet line, so `y` IS the absolute feet position: terrain line + depth
      // offset, independent of the depth scale (see module doc comment).
      heroView.y =
        (terrainOn ? terrain.groundY(fakeHero.x) : GROUND_Y) + (depthOn ? heroDepthOffY : 0);
      heroView.scale.set(depthOn ? heroDepthScl : 1);
      heroView.zIndex = depthOn ? heroDepthZ : HERO_INSERTION;

      // ---- mobs: slow home-wander sine --------------------------------------
      enemyCtx.dt = dt;
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]!;
        m.stub.x = m.homeX + Math.sin(t * m.wanderW + m.phase) * m.wanderAmp;
        updateEnemyView(m.view, m.stub, enemyCtx);
        // Same post-update feet placement as the hero (root pivoted at feet).
        m.view.y = (terrainOn ? terrain.groundY(m.stub.x) : GROUND_Y) + (depthOn ? m.depthOffY : 0);
        m.view.scale.set(depthOn ? m.depthScl : 1);
        m.view.zIndex = depthOn ? m.depthZ : m.insertion;
      }

      // ---- camera ------------------------------------------------------------
      if (cameraOn) {
        camTarget.x = fakeHero.x;
        camTarget.vx = vx;
        updateCamera(cam, camTarget, dt);
      }
      const ct = cameraTransform(cam, ctScratch); // out-param, zero alloc
      cameraRoot.scale.set(ct.scale);
      cameraRoot.position.set(ct.posX, ct.posY);
      farLayer.x = cam.x * (1 - FAR_FACTOR);
      midLayer.x = cam.x * (1 - MID_FACTOR);
      fgLayer.x = cam.x * (1 - FG_FACTOR);

      // ---- living world ------------------------------------------------------
      weather.update(dt);
      if (livingOn) critters.update(dt, palette.nightness);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      // Module owners first (they detach their own views), then the tree.
      weather.destroy();
      critters.destroy();
      view.mask = null;
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const btnBase = "min-h-10 rounded px-3 py-2 text-xs transition-colors";
const btnOff = "bg-slate-700 hover:bg-slate-600 text-slate-200";
const btnOn = "bg-amber-700 hover:bg-amber-600 text-white";

const FEATURE_LABELS = [
  { key: "depth", label: "① สนามลึก (ตัวละครใกล้-ไกล)" },
  { key: "camera", label: "② กล้องมีชีวิต (ตาม+ซูม)" },
  { key: "terrain", label: "③ พื้นไม่เรียบ (เนิน-หุบ)" },
  { key: "living", label: "④ โลกมีชีวิต (วัน-คืน/อากาศ/สัตว์)" },
] as const;

function WorldDepthControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [master, setMasterState] = useState(c.getMaster());
  const [depth, setDepthState] = useState(c.getDepth());
  const [camera, setCameraState] = useState(c.getCamera());
  const [terrain, setTerrainState] = useState(c.getTerrain());
  const [living, setLivingState] = useState(c.getLiving());
  const [zoneIdx, setZoneIdxState] = useState(c.getZoneIndex());
  const [weather, setWeatherState] = useState(c.getWeather());
  const [preset, setPresetState] = useState(c.getTerrainPreset());
  const [cycleSpeed, setCycleSpeedState] = useState(c.getCycleSpeed());

  const zoneOptions = useMemo(() => c.zones.map((z, i) => ({ i, label: zoneLabel(z) })), [c.zones]);

  const flagState: Record<(typeof FEATURE_LABELS)[number]["key"], boolean> = {
    depth,
    camera,
    terrain,
    living,
  };

  function syncAll(): void {
    setDepthState(c.getDepth());
    setCameraState(c.getCamera());
    setTerrainState(c.getTerrain());
    setLivingState(c.getLiving());
    setMasterState(c.getMaster());
  }

  function setFlag(key: (typeof FEATURE_LABELS)[number]["key"], v: boolean): void {
    if (key === "depth") c.setDepth(v);
    else if (key === "camera") c.setCamera(v);
    else if (key === "terrain") c.setTerrain(v);
    else c.setLiving(v);
    syncAll();
  }

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <button
        type="button"
        className={`${btnBase} ${master ? btnOn : btnOff}`}
        onClick={() => {
          c.setMaster(!master);
          syncAll();
        }}
      >
        {master ? "ทั้งหมดเปิด" : "แบบเดิมแบน"}
      </button>

      <div className="flex flex-col gap-1">
        {FEATURE_LABELS.map((f) => (
          <label key={f.key} className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              checked={flagState[f.key]}
              onChange={(e) => setFlag(f.key, e.target.checked)}
            />
            <span>{f.label}</span>
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span>ฉาก (biome)</span>
        <select
          className="rounded bg-slate-800 px-2 py-1"
          value={zoneIdx}
          onChange={(e) => {
            const v = Number(e.target.value);
            setZoneIdxState(v);
            c.setZoneIndex(v);
          }}
        >
          {zoneOptions.map((o) => (
            <option key={o.i} value={o.i}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span>สภาพอากาศ</span>
        <select
          className="rounded bg-slate-800 px-2 py-1"
          value={weather}
          onChange={(e) => {
            const v = e.target.value as WeatherKind;
            setWeatherState(v);
            c.setWeather(v);
          }}
        >
          {WEATHER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.labelTh}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span>รูปพื้น</span>
        <select
          className="rounded bg-slate-800 px-2 py-1"
          value={preset}
          onChange={(e) => {
            const v = e.target.value as TerrainPresetId;
            setPresetState(v);
            c.setTerrainPreset(v);
          }}
        >
          {TERRAIN_PRESETS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.labelTh}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2">
        <span>ความเร็ววัน-คืน</span>
        <input
          type="range"
          min={0}
          max={8}
          step={0.5}
          value={cycleSpeed}
          className="min-h-10 flex-1"
          onChange={(e) => {
            const v = Number(e.target.value);
            c.setCycleSpeed(v);
            setCycleSpeedState(v);
          }}
        />
        <span className="w-8 text-right tabular-nums">{cycleSpeed.toFixed(1)}×</span>
      </label>

      <button type="button" className={`${btnBase} ${btnOff}`} onClick={() => c.punchZoom()}>
        ซูมเน้นจังหวะ
      </button>

      <p className="text-slate-500">
        ปุ่มบนสุดสลับทุกอย่างพร้อมกันเพื่อเทียบ &quot;โลกมีมิติ&quot; กับหน้าจอแบนแบบเดิม —
        หรือติ๊กทีละข้อเพื่อดูว่าแต่ละชิ้นให้ความรู้สึกต่างแค่ไหน
      </p>
    </div>
  );
}

export const worldDepthExperiment: LabExperiment = {
  id: "worldDepth",
  title: "⑨ โลกมีมิติ",
  desc: "เดโมสนามลึก 2.5D / กล้องติดตาม-ซูม / พื้นเนินสูงต่ำ / กลางวัน-กลางคืน+สภาพอากาศ — สลับเทียบกับแบบเดิมแบนได้ทีละอย่าง",
  Controls: WorldDepthControls,
  createScene,
};
