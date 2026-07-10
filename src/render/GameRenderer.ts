/**
 * The Pixi render layer's public entry point.
 *
 * Lifecycle contract (driven by the integration layer, NOT by this class):
 *   const renderer = new GameRenderer();
 *   await renderer.create(canvasParent);       // once, client-only (e.g. in a useEffect)
 *   renderer.draw(state, frameEvents);         // every rAF; frameEvents = this frame's
 *                                               // sub-steps' state.events, concatenated
 *                                               // by the caller (see GameClient.tsx).
 *                                               // Omit frameEvents and fx just idles.
 *   renderer.destroy();                        // on unmount — safe to call even if
 *                                               // create() never resolved, and safe to
 *                                               // call create() again afterwards
 *                                               // (covers React StrictMode's mount/
 *                                               // unmount/mount dev double-invoke).
 *
 * One-way data flow: `draw()` only reads `GameState` fields and mutates Pixi
 * display objects. It never mutates `state` and never calls back into `@/engine`.
 */

import { Application, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  isDailyComplete,
  mainQuestChapters,
  scatterPlaneY,
  tomePagesFound,
  zoneAt,
  type Zone,
} from "@/engine";
import type { GameEvent, HitTargetKind } from "@/engine/state";
import type { GameState } from "@/engine/state";
import { Pool } from "@/render/Pool";
import { Environment } from "@/render/environment/Environment";
import { FxController } from "@/render/fx/FxController";
import { RENDER_FX } from "@/render/fxConfig";
import { createBloomFilter } from "@/render/fx/impactFilters";
import {
  computeFullscreenTransform,
  computeVisibleWorldRect,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type VisibleWorldRect,
  type WorldTransform,
} from "@/render/layout";
import { createAtmosphere, type Atmosphere } from "@/render/worldDepth/atmosphere";
import {
  createCamera,
  updateCamera,
  cameraTransform,
  setViewW,
  type CameraState,
  type CameraTransform,
} from "@/render/worldDepth/camera";
import {
  depthOffsetY,
  depthZIndex,
  DEPTH_OFFSET_FAR,
  DEPTH_OFFSET_NEAR,
} from "@/render/worldDepth/depthBand";
import {
  canvasToWorld,
  enemyTapCenterY,
  tapToPlaneY,
  worldBossTapCenterY,
  worldScale,
  type CamView,
  type WorldPoint,
} from "@/render/worldDepth/hitTestMath";
import {
  createWorldFxContext,
  DEPTH_NEUTRAL,
  planeToDepth,
  type WorldFxContext,
} from "@/render/worldDepth/worldFxContext";
import { biomeForZone } from "@/render/environment/biomes";
import {
  buildMapProps,
  mapPropsActiveForZone,
  type MapPropSpec,
} from "@/render/environment/mapProps";
import { PALETTE, safeRadius } from "@/render/theme";
import { createBossView, updateBossView, type BossView } from "@/render/views/bossView";
import {
  createWorldBossView,
  updateWorldBossView,
  WORLD_BOSS_CORE_R,
  WORLD_BOSS_CY,
  type WorldBossView,
} from "@/render/views/worldBossView";
import {
  createEnemyView,
  effectiveSize,
  updateEnemyView,
  type EnemyView,
} from "@/render/views/enemyView";
import {
  attachContactShadow,
  BOSS_SHADOW_RX,
  ENEMY_SHADOW_RX,
  HERO_SHADOW_RX,
  NPC_SHADOW_RX,
  WORLD_BOSS_SHADOW_RX,
  type HasContactShadow,
} from "@/render/views/entityShadow";
import { createHeroView, updateHeroView, type HeroView } from "@/render/views/heroView";
import { GhostLayer, type GhostDrawItem } from "@/render/views/ghostLayer";
import { createNpcView, updateNpcView, type NpcView } from "@/render/views/npcView";
import {
  createProjectileView,
  updateProjectileView,
  type ProjectileView,
} from "@/render/views/projectileView";
import { NpcSpeechBubble } from "@/render/fx/npcSpeechBubble";
import { gateTapSide } from "@/render/environment/zoneGates";
import { TOWN_NPCS, type TownNpcId } from "@/render/townNpcs";
import { createTownLlamaActor, type TownLlamaActor } from "@/render/environment/townLlama";
import {
  TownHonorBoard,
  type TownChampionEntry,
} from "@/render/environment/townHonorBoard";

/**
 * Manual play (M7.8) tap outcome: a live enemy id (monsters WIN over ground
 * on overlap) or a ground tap reporting the world-x under the pointer PLUS the
 * band `planeY` it landed on (R4 Wave C2). The engine clamps both `moveTo.x`
 * (walkable bounds) and `moveTo.y` (plane band) at intake — see `systems/manual.ts`
 * — so this just reports the un-projected position. `null` for a tap outside the
 * logical world rect (the letterbox bars).
 */
export type PointerHitResult =
  | { kind: "monster"; id: number }
  // R4 Wave C2: `planeY` = the band-clamped depth row the ground tap landed on (inverted
  // from the tapped world-y through `depthOffsetY`), fed into `moveTo.y` for an x/y move.
  | { kind: "ground"; x: number; planeY: number }
  | null;

/**
 * Town NPCs (ป้าปุ๊/ลุงดึ๋ง) tap outcome — see `hitTestNpc()`. Kept as a
 * SEPARATE method/type from `hitTestPointer()`/`PointerHitResult` above
 * (rather than folded into that union) so this task's render-only plumbing
 * can land without touching `GameClient.tsx`'s existing tap-handler
 * (`hit.kind === "monster" ? ... : hit.x` narrowing) — the later UI-gating
 * wave is expected to call this alongside `hitTestPointer()` (NPC check
 * first while in town, since the town zone never has live enemies).
 */
export type NpcHitResult = { kind: "npc"; id: TownNpcId } | null;

/**
 * Zone-edge gate tap outcome (R1 W2 "tappable gates" — replaces the ◀ ▶ walk
 * arrows) — see `hitTestGate()`. Purely geometric ("which side was tapped"),
 * same separation-of-concerns as `NpcHitResult` above: this method never
 * decides whether the neighbor is unlocked/exists — `GameClient.tsx`'s
 * `onArenaClick` reads `worldNav(state)` for that (via the pure
 * `resolveGateTap()`, `@/ui/world/gateTap.ts`), the exact same read
 * `WalkControls.tsx`'s old arrows used.
 */
export type GateHitResult = { kind: "gate"; side: "left" | "right" } | null;

/**
 * Ghost-presence "tap profile" outcome (R3 issue #50 Wave 5) — see
 * `hitTestGhost()`. VIEW-ONLY, same separation-of-concerns as
 * `NpcHitResult`/`GateHitResult` above: this never produces a command intent,
 * it only reports which peer's cosmetic identity was tapped (`GameClient.tsx`
 * opens a read-only profile card and fully consumes the tap — no `moveTo`).
 */
export type GhostHitResult = {
  kind: "ghost";
  cid: string;
  name: string;
  cls: GhostDrawItem["cls"];
  tier: GhostDrawItem["tier"];
} | null;

/** Minimum on-screen touch half-extent (CSS px, NOT world units) a monster
 * hit-test guarantees regardless of the current letterbox scale — the task's
 * "≥24px half-extent on mobile" requirement. Converted to world units per-call
 * via the live `baseTransform.scale` (see `hitTestPointer()`). */
const TOUCH_HALF_EXTENT_PX = 24;

/**
 * Ghost tap-target knobs (owner eye-test, PR #62 / issue #50): the ghost rig
 * reuses `HeroView` (see `heroView.ts`'s `HEAD_Y = GROUND_Y - 48`) — a MUCH
 * taller silhouette than the generic monster ellipse `hitTestPointer` sizes
 * for (`16 * size*scl` / `22 * size*scl`, centered a mere 14 units above the
 * foot line). That combo left most of a ghost's visible body/head OUTSIDE the
 * old tap ellipse, matching the owner's "hit box มันเล็ก" report even though
 * the `TOUCH_HALF_EXTENT_PX` floor already guaranteed a ~48px circle — the
 * circle just sat low, hugging the ankles.
 *
 * Dedicated (not shared with `hitTestPointer`/`hitTestGate`) so tuning the
 * ghost feel never touches monster/gate taps. `GHOST_TAP_RX` stays modest —
 * a wide ellipse would start stealing nearby ground-tap moveTo's; the fix is
 * height, not width — `GHOST_TAP_RY` covers from just below the feet up past
 * the head. `GHOST_TAP_CENTER_SIZE` is fed into the SAME `enemyTapCenterY`
 * used elsewhere (as its `size` param, rise = `TAP_CENTER_RISE_PER_SIZE ·
 * size`) to lift the ellipse center from ankle height (old: 14 world units,
 * size=1) to roughly torso height (28 world units, size=2) — the natural spot
 * a fingertip lands when tapping "on the rig".
 */
const GHOST_TAP_RX = 18;
const GHOST_TAP_RY = 42;
const GHOST_TAP_CENTER_SIZE = 2;

// ---------------------------------------------------------------------------
// Living-camera knobs (promoted "โลกมีมิติ" layer, W2). The camera follows the
// pov hero at `ZOOM_BASE` and eases back to `IDLE_ZOOM` when he stands still.
// INVERTED vs the /lab default (idle-zoom-OUT): a 900px world cannot zoom below
// 1.0 without revealing the letterbox void, so idle relaxes to the full view
// (1.0) and play tightens to 1.06. Default OFF (see `worldFxFlags`) until the
// settings wave flips it, so every existing screenshot stays pixel-identical.
// ---------------------------------------------------------------------------
const CAMERA_ZOOM_BASE = 1.06;
const CAMERA_IDLE_ZOOM = 1.0;

interface Layers {
  /** Static sky/ground/grid, drawn once. */
  background: Container;
  /** Heroes, enemies, boss. */
  entities: Container;
  projectiles: Container;
  /** M4 juice: damage numbers, particle bursts, rings, arena flash — owned by
   * `FxController`. Hit-flash itself tints entity views directly (in
   * `entities`), not this layer. */
  fx: Container;
  /** Screen-anchored, arena-embedded readouts (currently: the boss HP bar). */
  overlay: Container;
}

export class GameRenderer {
  private app: Application | null = null;
  private world: Container | null = null;
  private layers: Layers | null = null;
  private heroPool: Pool<HeroView> | null = null;
  /** Ghost-presence layer (docs/ghost-presence-design.md §3.5): OTHER online players in
   * my zone, drawn BELOW my own heroes, walk/idle-only, excluded from hit-testing. Fed a
   * display-only list via `setGhosts()`; NEVER reads `GameState`. Null until `create()`. */
  private ghostLayer: GhostLayer | null = null;
  /** The last ghost render list `setGhosts()` received — applied every `draw()` with the
   * real dt (so the rig walk cadence uses the same clock as `fx/`). */
  private ghostList: readonly GhostDrawItem[] = [];
  private enemyPool: Pool<EnemyView> | null = null;
  private projectilePool: Pool<ProjectileView> | null = null;
  private bossView: BossView | null = null;
  private bossHpBar: Graphics | null = null;
  private bossLabel: Text | null = null;
  /** WORLD BOSS "เสี่ยจ๋อง" (hourly world boss, render wave): a SEPARATE live
   * view from `bossView`/`bossHpBar` above — `state.worldBoss.entity` is a
   * distinct field from `state.boss` (the two are mutually exclusive: a stage
   * boss only lives in a boss room, the world boss only in an open farm
   * zone), so it gets its own create/destroy lifecycle + its own gold-trimmed
   * overlay (nameplate + wide HP bar) instead of sharing the stage boss's. */
  private worldBossView: WorldBossView | null = null;
  private worldBossHpBar: Graphics | null = null;
  private worldBossPlate: Graphics | null = null;
  private worldBossLabel: Text | null = null;
  /** id of the live world-boss entity `this.worldBossView` represents (mirrors
   * `currentBossId`'s hit-flash-lookup-correctness reasoning across a
   * defeat -> next-window-spawn id change). */
  private currentWorldBossId: number | null = null;
  /** ป้าปุ๊/ลุงดึ๋ง — fixed-position town actors, built once in `create()` and
   * kept for the whole session (never pooled-by-id like heroes/enemies,
   * there are always exactly the two of them). Visibility toggles with the
   * current zone kind every `draw()`. */
  private npcViews: Map<TownNpcId, NpcView> | null = null;
  private npcSpeech: NpcSpeechBubble | null = null;
  /** Owner's fun/off-theme pixel llama (town-only ambient decor, see
   * `environment/townLlama.ts`). Built once, never null after `create()` even
   * if its texture load fails/never resolves — `update()` is a cheap no-op
   * until the load succeeds. Lives in `background` (behind every entity),
   * NOT alongside `npcViews`. */
  private llama: TownLlamaActor | null = null;
  /** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 3): the town
   * honor plaque. Built once, added to `background` (same layer/lifecycle
   * convention as `llama` above). Stays invisible until `setTownChampions()`
   * is ever called — see `TownHonorBoard`'s own "never called = pixel-
   * identical" doc comment. */
  private honorBoard: TownHonorBoard | null = null;
  /** Defensive-read storage (mirrors `heroDisplayNames`/`povHeroIndex`'s own
   * convention) so `setTownChampions()` is safe to call before `create()`
   * resolves — re-applied to a freshly-built `honorBoard` in `create()`. */
  private townChampions: readonly TownChampionEntry[] | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private startTime = 0;
  /** Real elapsed ms at the previous draw() call — used to derive a real-time
   * dt for fx (never the sub-step count, so speed x2/x3 never fast-forwards
   * the juice itself). */
  private lastDrawMs = 0;
  /** The letterbox transform from the last resize; screenshake composes an
   * offset ON TOP of this each draw(), never mutating it. */
  private baseTransform: WorldTransform = { scale: 1, x: 0, y: 0 };
  private fx: FxController | null = null;
  private environment: Environment | null = null;
  /** id of the boss `this.bossView` currently represents (for hit-flash lookup
   * correctness across a defeat -> new-boss-spawn id change). */
  private currentBossId: number | null = null;
  /** Previous frame's `state.anchorX`, used to derive the "formation is
   * advancing" cue heroView reads for its determined-march lean/bob boost. */
  private lastAnchorX: number | null = null;
  /**
   * M8 party P6 hook: per-hero display names for the nameplate shown above
   * non-primary heroes (slot !== 0) — `Hero` has no name/identity field
   * (engine stays untouched), so this is the seam the LATER networking/room
   * wiring calls (e.g. on cohort membership change) to supply each peer's
   * name. `null`/unset hides every nameplate (today's solo/sim-only state).
   * See `setHeroDisplayNames()`.
   */
  private heroDisplayNames: ReadonlyMap<number, string> | null = null;
  /**
   * HOF seasonal rewards (docs/hof-rewards-design.md §3, render wave): per-
   * hero-id season badge (title tag text + champion gold-aura flag) — same
   * "no identity field on `Hero`" reasoning / defensive-read convention as
   * `heroDisplayNames` above. Forwarded to `FxController.setHeroSocialBadges()`
   * for the continuous champion-aura read, and threaded into each hero's
   * `HeroFrameContext.socialBadge` for the title-tag text (see
   * `setHeroSocialBadges()`).
   */
  private heroSocialBadges: ReadonlyMap<
    string,
    { title: string | null; champion: boolean }
  > | null = null;
  /**
   * M8 party P6 hook: index into `state.heroes` of the LOCAL point-of-view
   * hero — forwarded to `FxController.setPovHeroIndex()` so a co-op friend's
   * ultimate keeps its world-anchored spectacle (visible to everyone) while
   * SCREEN-level beats (camera shake/punch, sky-darken/flash overlays, impact
   * filters) only fire for the hero this client actually controls. Stored
   * here (not just forwarded) so it survives an `FxController` being torn
   * down/recreated (mirrors `heroDisplayNames`'s own defensive-read
   * convention) — applied to a freshly-constructed `FxController` in
   * `create()` regardless of call order against `setPovHeroIndex()`. Default 0
   * matches solo's always-slot-0 hero.
   */
  private povHeroIndex = 0;

  /**
   * THE shared "โลกมีมิติ" seam (W2): pure math owned here, handed to the
   * `GhostLayer` (and, in later waves, `FxController`/hit-test) so every
   * consumer resolves the SAME ground line + depth. Persistent (never
   * recreated on destroy) so flags registered before `create()` survive, and
   * so the ghost layer always holds a live reference. All flags default OFF =
   * groundY≡GROUND_Y / footY≡GROUND_Y / depthScale≡1 = pixel-identical today.
   */
  private readonly worldFx: WorldFxContext = createWorldFxContext();
  /** Current world-fx flag set (stored like `povHeroIndex` for defensive
   * re-apply in `create()`). `camera`/`atmosphere` are tracked here too even
   * though they aren't `worldFx` (ground/depth) concerns, so a single
   * `setWorldFx()` drives all four. */
  private worldFxFlags: {
    depth: boolean;
    terrain: boolean;
    camera: boolean;
    atmosphere: boolean;
  } = {
    depth: false,
    terrain: false,
    camera: false,
    atmosphere: false,
  };
  /** W5 atmosphere runtime (day/night tint + weather + critters) — owns its
   * own Pixi views hosted across `background`/`ghosts`/`entities`/
   * `cameraRoot`/`world`. Built in `create()`, torn down in `destroy()`;
   * `null` in between (same lifecycle convention as `environment`/
   * `ghostLayer`). */
  private atmosphere: Atmosphere | null = null;
  /** `setAtmosphereDensity()`'s stored value (defensive re-apply convention,
   * like `worldFxFlags`) — the perf valve GameClient drives from its
   * ghost-fps EMA (W6): 1 full / 0.5 reduced / 0 hidden. Only matters once
   * `setWorldFx({atmosphere: true, ...})` turns the feature on; default 1. */
  private atmosphereDensity = 1;
  /** Living-camera state (created in `create()`, reset per session). Null until
   * then. */
  private camera: CameraState | null = null;
  /** Camera-driven world content rides this child of `world`; `overlay`
   * (screen-anchored boss bars) does NOT, so HP bars never pan/zoom. */
  private cameraRoot: Container | null = null;
  /** World-local mask rect clipping `cameraRoot` so a >1.0 follow-zoom never
   * spills content onto the letterbox bars. */
  private cameraMask: Graphics | null = null;
  /** Previous frame's camera target x (finite-difference velocity source);
   * null = re-seed vx to 0 next frame (first frame / after a camera-off snap). */
  private lastCamTargetX: number | null = null;
  /** Reused out-params (zero per-frame alloc, same convention as the fx layer). */
  private readonly camScratch: CameraTransform = { posX: 0, posY: 0, scale: 1 };
  private readonly hitScratch: WorldPoint = { x: 0, y: 0 };
  /** Per-frame `enemy id -> depth d` map, filled during the enemy pass and read
   * by the projectile pass to lift a homing shot toward its target's depth row.
   * Reused (cleared each frame) — zero alloc. */
  private readonly enemyDepthScratch = new Map<number, number>();

  /**
   * R4.5 Wave 2C world props (`environment/mapProps.ts`) — code-drawn, visual-
   * only decoration for map2 farm zones. Standing props (trees/rocks/lamp/sign/
   * gate fragment) live DIRECTLY in `entities` so they share the actor depth
   * sort domain (Wave 1.2); the near-layer container frames the near edge with a
   * fixed high zIndex. Built ONCE on a zone (or depth/terrain flag) change and
   * torn down/rebuilt on transition — never per frame (`mapPropsKey` gates the
   * rebuild). The `entities` Pool only sweeps ids IT created, so these siblings
   * never disturb actor pool sorting (Pool.ts guarantee). Aligned arrays: each
   * `mapPropSpecs[i]` describes `mapPropViews[i]`. */
  private mapPropViews: Graphics[] = [];
  private mapPropSpecs: MapPropSpec[] = [];
  private mapPropsNear: Container | null = null;
  /** `mapId:zoneIdx:depthOn:terrainOn` the current props were built for (`null`
   * = none built / not a map2 farm zone). A change triggers rebuild. */
  private mapPropsKey: string | null = null;

  /** Set up the Pixi Application and scene layers. Client-only. */
  async create(canvasParent: HTMLElement): Promise<void> {
    // Idempotent: a stray double-mount (React StrictMode) tears down any prior
    // instance before building a fresh one instead of leaking two Applications.
    if (this.app) this.destroy();

    // Pixi v8's WebGL renderer requires WebGL2 (WebGL1 is unsupported); we force
    // `preference: "webgl"` below because WebGPU is still flaky on mobile
    // Chrome/Safari. Probe WebGL2 up front so an unsupported device fails with a
    // clear, catchable error instead of an opaque `Application.init()` rejection
    // that the caller can only surface as "something went wrong".
    if (!isWebGL2Available()) {
      throw new Error(
        "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ WebGL2 ซึ่งจำเป็นต่อการเรนเดอร์เกม",
      );
    }

    const app = new Application();
    await app.init({
      backgroundColor: PALETTE.arenaSky,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
    this.app = app;
    this.startTime = performance.now();
    this.lastDrawMs = 0;
    this.lastAnchorX = null;
    canvasParent.appendChild(app.canvas);

    const world = new Container();
    // Placeholder rect — `handleResize()` (called at the end of `create()`,
    // and on every subsequent resize) immediately overwrites this to cover
    // the FULL visible extent (letterbox band + decorative bleed, R2.5 "Game
    // Screen" W1) and tells `fx/impactFilters.ts`'s controller where its
    // origin now sits; see that file's doc comment for exactly why the
    // shockwave filter's world-coord -> filter-space mapping needs that.
    world.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    app.stage.addChild(world);
    this.world = world;

    const background = new Container();
    const ghosts = new Container();
    const entities = new Container();
    const projectiles = new Container();
    const fx = new Container();
    const overlay = new Container();
    // Living camera (W2): background/ghosts/entities/projectiles/fx ride a
    // `cameraRoot` child of `world` that the camera pans/zooms; `overlay`
    // (screen-anchored boss HP bars) stays DIRECTLY on `world` so it never
    // moves. A world-local mask rect clips `cameraRoot` so a 1.06 follow-zoom
    // never spills content onto the letterbox bars. With the camera OFF
    // (default) `cameraRoot` is an identity transform, so this composition is
    // pixel-identical to adding the five layers straight to `world`.
    // `ghosts` sits BETWEEN background and entities. Since R4.5 Wave 1.2 (#69) it no longer
    // hosts the ghost VIEWS themselves — those moved into the shared `entities` container so
    // depth can interleave peers with my hero/enemy roots (see `GhostLayer`). It stays in
    // the stack purely as `atmosphere.ts`'s dedicated ghost ambient-tint slot + a stable
    // cameraRoot child index; it renders nothing on its own now (empty container). Ghosts
    // remain invisible to `hitTestPointer` regardless — that scans `state.enemies`/
    // `worldBoss`, never any container's children (invariant #5).
    const cameraRoot = new Container();
    cameraRoot.addChild(background, ghosts, entities, projectiles, fx);
    world.addChild(cameraRoot, overlay);
    // Built empty here — `handleResize()` (called at the end of `create()`,
    // and on every subsequent resize) draws the real rect via
    // `redrawCameraMask()`, sized to cover the FULL visible extent (letterbox
    // band + decorative sky/ground bleed, R2.5 "Game Screen" W1), never just
    // the fixed WORLD_WIDTH x WORLD_HEIGHT box.
    const cameraMask = new Graphics();
    // The mask only engages while the camera is ON — a >1.0 follow-zoom is the
    // only thing that can push content into the letterbox bars. With the camera
    // OFF the mask is detached AND hidden (activated in `setWorldFx` /
    // `snapCameraIdentity`), so the default OFF state clips NOTHING = pixel-
    // identical to today (incl. any edge bloom/fx that spills into the bars).
    cameraMask.visible = false;
    world.addChild(cameraMask);
    this.cameraRoot = cameraRoot;
    this.cameraMask = cameraMask;
    // Depth sort key layer: near entities draw OVER far ones when the depth
    // flag is on; with it off every hero/enemy gets zIndex 0 (equal), so Pixi's
    // stable sort preserves insertion order = today's paint order.
    entities.sortableChildren = true;
    this.layers = { background, entities, projectiles, fx, overlay };
    // #69: ghost roots live in the SHARED `entities` container so depth ordering
    // interleaves peers with my hero/enemy roots (was the separate `ghosts`
    // container, which could only sort ghosts among themselves).
    this.ghostLayer = new GhostLayer(entities, { worldFx: this.worldFx });

    // W5 atmosphere runtime: day/night tint + weather + critters, composed on
    // top of the same five layers (see `atmosphere.ts`'s doc comment for the
    // exact insertion points). Built AFTER `cameraRoot`/`overlay` are already
    // children of `world` and `entities` is already a child of `cameraRoot`
    // (both required for its internal `getChildIndex` placement math).
    this.atmosphere = createAtmosphere({ world, cameraRoot, background, ghosts, entities });

    // Living-camera state (reset per session). Knobs: follow-tight 1.06, relax
    // to the full view 1.0 when idle.
    this.camera = createCamera(WORLD_WIDTH, {
      zoomBase: CAMERA_ZOOM_BASE,
      idleZoom: CAMERA_IDLE_ZOOM,
    });
    this.lastCamTargetX = null;

    // Persistent, subtle bloom on the projectiles + fx layers ONLY (never the
    // whole stage) — one shared filter instance, see `createBloomFilter()`'s
    // doc comment for why sharing is safe here. `RENDER_FX.bloom` is the
    // runtime kill-switch (see `fxConfig.ts`).
    if (RENDER_FX.bloom) {
      const bloom = createBloomFilter();
      projectiles.filters = [bloom];
      fx.filters = [bloom];
    }

    this.environment = new Environment(background);

    // Owner's fun/off-theme pixel llama: a sibling of `Environment`'s own
    // biome scenes in the SAME `background` container — `Environment` only
    // ever adds/crossfades its own children, never clears the layer, so this
    // static-position actor persists untouched across every biome crossfade.
    // Being in `background` (before `entities` in z-order) is what puts it
    // behind every hero/enemy/NPC for free, with no manual z-index needed.
    this.llama = createTownLlamaActor();
    background.addChild(this.llama.view);

    // HOF seasonal rewards: same background-layer, built-once, zone-gated
    // lifecycle as `llama` above. Re-applies any `setTownChampions()` call
    // that arrived before `create()` resolved.
    this.honorBoard = new TownHonorBoard();
    background.addChild(this.honorBoard.view);
    if (this.townChampions) this.honorBoard.setEntries(this.townChampions);

    // Pivot the hero/enemy ROOTS at the foot line (y = GROUND_Y) so depth scale
    // grows the rig around its feet and terrain lift plants the feet exactly on
    // the ground. Done HERE (in the pool factory), never inside
    // `createHeroView`/`createEnemyView`, so `rig.test.ts` — which calls those
    // directly — stays byte-untouched. The paired per-frame `view.y = footY`
    // (below, in `draw()`) cancels the pivot to GROUND_Y when flags are off, so
    // the rendered result is identical to today's pivot-0 / y-0 rig.
    // R4.5 Wave 1: attach a build-once contact shadow as the backmost child of
    // each pooled actor root (see `entityShadow.ts`). The root's GROUND_Y pivot
    // + per-frame foot plant plants the shadow on the ground with the SAME
    // transform the actor rides (no re-added offset — known-traps #3); it also
    // rides the root's depth scale for free, and is destroyed with the view on
    // pool sweep (no orphan shadows).
    this.heroPool = new Pool(entities, () => {
      const v = createHeroView();
      v.pivot.y = GROUND_Y;
      attachContactShadow(v, HERO_SHADOW_RX);
      return v;
    });
    this.enemyPool = new Pool(entities, () => {
      const v = createEnemyView();
      v.pivot.y = GROUND_Y;
      attachContactShadow(v, ENEMY_SHADOW_RX);
      return v;
    });
    this.projectilePool = new Pool(projectiles, createProjectileView);

    this.bossHpBar = new Graphics();
    this.bossLabel = new Text({
      text: "",
      style: {
        fontSize: 12,
        fontWeight: "600",
        fill: PALETTE.ivory,
        fontFamily: "sans-serif",
      },
    });
    overlay.addChild(this.bossHpBar, this.bossLabel);

    // WORLD BOSS "เสี่ยจ๋อง" overlay: gold-trimmed nameplate backdrop + wide gold
    // HP bar. Never visible at the same time as the stage-boss overlay above
    // (mutually exclusive phases — see the field doc comments), so sharing the
    // same on-screen band (bx/by) is safe; kept as separate Graphics/Text
    // instances so each gets its own distinct gold-trim look.
    this.worldBossPlate = new Graphics();
    this.worldBossHpBar = new Graphics();
    this.worldBossLabel = new Text({
      text: "เสี่ยจ๋อง",
      style: {
        fontSize: 13,
        fontWeight: "700",
        fill: PALETTE.worldBossPlateGold,
        fontFamily: "sans-serif",
      },
    });
    // Order matters (z-index by insertion): plate backdrop first, then the
    // bar, then the name text on top.
    overlay.addChild(this.worldBossPlate, this.worldBossHpBar, this.worldBossLabel);

    // Town NPCs (ป้าปุ๊/ลุงดึ๋ง): fixed-position, built once — same layer as
    // heroes/enemies/boss so they z-order correctly against the entity list,
    // even though they never move. Visibility is toggled per-frame in
    // `draw()` (only rendered while standing in the town zone).
    this.npcViews = new Map();
    for (const anchor of TOWN_NPCS) {
      const view = createNpcView(anchor.id);
      // Same foot-pivot convention as the pooled hero/enemy rigs; NPCs take
      // terrain lift only (never depth scale). `zIndex -500` keeps them behind
      // the walking hero (today's paint order, now explicit under the sorted
      // `entities` layer). Town is always flat terrain, so their `footY`
      // resolves to GROUND_Y = pixel-identical to today.
      view.pivot.y = GROUND_Y;
      view.zIndex = -500;
      // Same contact-shadow primitive as the pooled actors (town is flat, so the
      // shadow just sits at GROUND_Y under each NPC's feet).
      attachContactShadow(view, NPC_SHADOW_RX);
      entities.addChild(view);
      this.npcViews.set(anchor.id, view);
    }
    this.npcSpeech = new NpcSpeechBubble(fx);

    this.fx = new FxController(
      fx,
      world,
      (target, id) => this.getEntityView(target, id),
      (id) => this.heroPool?.peek(id) ?? null,
      // W4 "โลกมีมิติ": host the pixel-weapon-fx layer on the camera-panned
      // `cameraRoot` + hand the fx layer the shared ground/depth seam so its
      // kill/impact/foot anchors ride terrain. Flags default OFF ⇒ identity.
      { cameraRoot: this.cameraRoot, worldFx: this.worldFx },
    );
    // Apply whatever POV index was already registered (possibly before
    // `create()` resolved) — same "ordering doesn't matter" guarantee
    // `setHeroDisplayNames()` gives, applied here instead of a defensive read
    // in `draw()` since the fx controller owns the gating state itself.
    this.fx.setPovHeroIndex(this.povHeroIndex);
    this.fx.setHeroSocialBadges(this.heroSocialBadges);

    // Defensive re-apply of any world-fx flags registered before `create()`
    // resolved (same "call order doesn't matter" guarantee as
    // `setPovHeroIndex()`). `worldFx` is persistent so its flags already hold;
    // this re-syncs them and snaps the freshly-built `cameraRoot` to identity
    // when the camera flag is off, so a fresh renderer starts pixel-identical.
    this.worldFx.setFlags({
      depth: this.worldFxFlags.depth,
      terrain: this.worldFxFlags.terrain,
    });
    this.environment?.setTerrainEnabled(this.worldFxFlags.terrain);
    if (this.worldFxFlags.camera) this.activateCameraMask();
    else this.snapCameraIdentity();
    this.atmosphere?.setEnabled(this.worldFxFlags.atmosphere);
    this.atmosphere?.setDensity(this.atmosphereDensity);

    // Pixi's built-in `resizeTo` only reacts to `window` resize events; a
    // ResizeObserver on the actual mount element is what makes layout-driven
    // (not just viewport) resizes (sidebar toggles, flex reflow, etc.) safe.
    this.resizeObserver = new ResizeObserver(() => this.handleResize(canvasParent));
    this.resizeObserver.observe(canvasParent);
    this.handleResize(canvasParent);
  }

  /**
   * One-way read of engine state -> Pixi display objects. Call every rAF.
   * `frameEvents` is the caller's cross-sub-step collection of this frame's
   * `state.events` (see `render/README.md` / the M4 task's collection
   * contract) — optional/defaulted so existing single-arg call sites keep
   * compiling; omit it and the fx layer simply reacts to nothing that frame.
   */
  draw(state: GameState, frameEvents: GameEvent[] = []): void {
    if (
      !this.app ||
      !this.layers ||
      !this.heroPool ||
      !this.enemyPool ||
      !this.projectilePool
    ) {
      return;
    }
    const elapsedMs = performance.now() - this.startTime;
    // Real wall-clock dt since the last draw(), clamped against a stalled tab
    // dumping one giant catch-up tick into the fx layer. This is deliberately
    // independent of the speed multiplier / sub-step count.
    const dt = Math.min(0.25, Math.max(0, (elapsedMs - this.lastDrawMs) / 1000));
    this.lastDrawMs = elapsedMs;

    // Bind the current zone's terrain to the shared seam ONCE per frame (cached
    // — same Zone → same Terrain instance, zero re-alloc). Must precede every
    // placement below so `footY`/`groundY` resolve against the right ground.
    // Captured once and reused by the atmosphere update at the bottom of this
    // method (W5) instead of a second `zoneAt` call — same value either way.
    const zone = zoneAt(state.location);
    this.worldFx.setZone(zone);

    // R4.5 Wave 2C world props: (re)build the map2-farm prop set on a zone (or
    // depth/terrain flag) change, else a cheap key-compare no-op. Standing props
    // join the shared `entities` sort domain; the near layer frames the edge.
    this.syncMapProps(zone);

    this.environment?.update(dt, state);

    const marching = this.lastAnchorX != null && state.anchorX > this.lastAnchorX + 1e-3;
    this.lastAnchorX = state.anchorX;

    const heroPool = this.heroPool;
    const partySize = state.heroes.length;
    heroPool.beginFrame();
    state.heroes.forEach((h, slot) => {
      const view = heroPool.get(h.id);
      updateHeroView(view, h, {
        dt,
        slot,
        events: frameEvents,
        marching,
        displayName: this.heroDisplayNames?.get(h.id) ?? null,
        socialBadge: this.heroSocialBadges?.get(String(h.id)) ?? null,
      });
      // R4 Wave B: hand the engine-owned `h.planeY` (solo formation row, or the
      // party fan stamped at cohort build) to the seam — it reads that in place
      // of recomputing the hero depth, falling back to the hash path if absent.
      this.placeActor(view, h.x, this.worldFx.depthOf("hero", h.id, slot, partySize, h.planeY));
    });
    heroPool.endFrame();

    // Ghost-presence layer: OTHER players in my zone, drawn under my heroes. Driven by the
    // SAME real-dt walk clock as the pooled heroes above; `ghostList` is a pure display
    // feed (`setGhosts`) that never touches `state`. Empty list = nothing drawn (solo /
    // feature off) at zero cost.
    this.ghostLayer?.update(this.ghostList, dt);

    // Enemies list is empty during the boss phase (the sim clears it on entry).
    // M7.9 "new mob species": resolved from the CURRENT zone, same
    // `zoneAt(state.location).mapId` plumbing as the boss theme below — safe
    // because it's only read once, at a view's first-sight `buildRig()` (an
    // enemy never changes map mid-life).
    const enemyMapId = zoneAt(state.location).mapId;
    this.enemyDepthScratch.clear();
    this.enemyPool.beginFrame();
    for (const e of state.enemies) {
      const view = this.enemyPool.get(e.id);
      updateEnemyView(view, e, { dt, events: frameEvents, mapId: enemyMapId });
      // Contact-shadow footprint tracks the enemy's drawn size (elite-scaled to
      // match the body); a transform-only set (zero alloc). The root depth scale
      // then applies on top of this local scale.
      (view as EnemyView & HasContactShadow).contactShadow.scale.set(effectiveSize(e));
      // R4 Wave B: engine-owned `e.planeY` (stable per-id band scatter; boss adds
      // carry it too) drives the row — hash fallback if absent.
      const d = this.worldFx.depthOf("enemy", e.id, undefined, undefined, e.planeY);
      this.placeActor(view, e.x, d);
      this.enemyDepthScratch.set(e.id, d);
    }
    this.enemyPool.endFrame();

    if (state.boss) {
      if (!this.bossView) {
        this.bossView = createBossView();
        // Foot-pivot like every other rig; `zIndex +10000` keeps the stage boss
        // drawn OVER the heroes (today's paint order — it is `addChild`'d after
        // them). Terrain lift only, never depth scale (see `placeStaticActor`).
        this.bossView.pivot.y = GROUND_Y;
        this.bossView.zIndex = 10000;
        attachContactShadow(this.bossView, BOSS_SHADOW_RX);
        this.layers.entities.addChild(this.bossView);
      }
      // M7.9 "Grand Expansion": the boss entity itself is map-agnostic (see
      // `engine/entities/index.ts`'s `Boss`), so the per-boss silhouette/
      // palette theme is resolved here from the CURRENT zone instead — valid
      // because `state.boss` is only ever non-null while standing in that
      // map's boss room (see `engine/systems/world.ts`).
      const mapId = zoneAt(state.location).mapId;
      updateBossView(this.bossView, state.boss, { elapsedMs, dt, events: frameEvents, mapId });
      this.placeStaticActor(this.bossView, state.boss.x);
      this.currentBossId = state.boss.id;
    } else if (this.bossView) {
      this.layers.entities.removeChild(this.bossView);
      this.bossView.destroy({ children: true });
      this.bossView = null;
      this.currentBossId = null;
    }
    this.drawBossOverlay(state);

    // WORLD BOSS "เสี่ยจ๋อง" (hourly world boss, render wave): a SEPARATE live
    // entity from `state.boss` (see the field doc comment above) — it lives
    // alongside the normal farm enemies during the BATTLE phase, so its view
    // is created/destroyed independent of the stage-boss branch above.
    const wb = state.worldBoss;
    if (wb && wb.active && wb.entity) {
      if (!this.worldBossView) {
        this.worldBossView = createWorldBossView();
        // BEHIND every hero/enemy/boss view (Pixi draws in child order, and the
        // world boss spawns AFTER the pools exist, so a plain addChild painted the
        // ~2.5x tycoon OVER the heroes standing in front of him — owner report
        // 2026-07-08 "hero โดนเสี่ยจ๋องบัง"). `zIndex -10000` makes that explicit
        // under the now-sorted `entities` layer; the `addChildAt(…,0)` stays as
        // belt-and-braces. His nameplate/HP bar live on `overlay` (unaffected).
        // Foot-pivot + terrain lift only (never depth scale), like the boss.
        this.worldBossView.pivot.y = GROUND_Y;
        this.worldBossView.zIndex = -10000;
        attachContactShadow(this.worldBossView, WORLD_BOSS_SHADOW_RX);
        this.layers.entities.addChildAt(this.worldBossView, 0);
      }
      updateWorldBossView(this.worldBossView, wb.entity, { elapsedMs, dt, events: frameEvents });
      this.placeStaticActor(this.worldBossView, wb.entity.x);
      this.currentWorldBossId = wb.entity.id;
    } else if (this.worldBossView) {
      this.layers.entities.removeChild(this.worldBossView);
      this.worldBossView.destroy({ children: true });
      this.worldBossView = null;
      this.currentWorldBossId = null;
    }
    this.drawWorldBossOverlay(state);

    // Town NPCs: only animate/render while actually standing in the town
    // zone — `zoneAt` is the same sanctioned read `enemyMapId`/the boss theme
    // lookup above already use.
    const inTown = zoneAt(state.location).kind === "town";
    if (this.npcViews) {
      // M8 quest Wave C: ผู้ใหญ่บ้าน's "!" badge — any main-chapter reward
      // claimable, or any daily quest complete-but-unclaimed. Pure engine
      // reads (same one-way "render reads GameState" contract as `enemyMapId`
      // above); cheap enough (<=6 chapters, <=3 dailies) to recompute every
      // frame rather than caching.
      const questBoardHasNotice =
        mainQuestChapters(state).some((c) => c.claimable) ||
        (state.heroes[0]?.dailies.quests.some((dq) => isDailyComplete(dq) && !dq.claimed) ?? false);
      // Tome-wave: ลุงดึ๋ง's "!" badge — the player holds "ตำราตำนาน" pages but
      // hasn't assembled the tome yet, mirroring the elder's precedent above
      // (same pure `state` read, same per-frame recompute — never cached).
      const smithHasTomeNotice = tomePagesFound(state) > 0 && !state.tomeUnlocked;
      for (const view of this.npcViews.values()) {
        updateNpcView(view, {
          dt,
          visible: inTown,
          showIndicator:
            view.npcId === "npc:elder"
              ? questBoardHasNotice
              : view.npcId === "npc:lungdueng"
                ? smithHasTomeNotice
                : false,
        });
        // `updateNpcView` never touches the root position (set once at
        // creation), so re-plant the feet each frame to cancel the GROUND_Y
        // pivot. Town is flat → this resolves to GROUND_Y (pixel-identical).
        this.placeStaticActor(view, view.x);
      }
    }
    this.npcSpeech?.update(dt);
    this.llama?.update(dt, inTown);
    this.honorBoard?.update(dt, inTown);

    this.projectilePool.beginFrame();
    for (const p of state.projectiles) {
      const view = this.projectilePool.get(p.id);
      updateProjectileView(view, p, state);
      // Render-only lift so a shot rides the sloped ground / reaches a
      // depth-lifted target. APPROXIMATION (documented): terrain lift is sampled
      // at the projectile's OWN x (not the target's — projectileView owns the
      // target lookup, we don't reach into it), and a homing shot additionally
      // borrows its target ENEMY's depth offset from the pass above. Both terms
      // are 0 when the matching flag is off → `view.y` stays `p.y` (identical).
      let offset = this.worldFx.lift(p.x);
      if (this.worldFxFlags.depth && p.targetId != null) {
        const td = this.enemyDepthScratch.get(p.targetId);
        if (td !== undefined) offset += depthOffsetY(td);
      }
      view.y += offset;
    }
    this.projectilePool.endFrame();

    // fx: entity views for this frame all exist by now, so hit-flash lookups
    // (by id) resolve correctly even for entities that just spawned.
    if (this.fx) {
      if (frameEvents.length) this.fx.consumeEvents(frameEvents, state);
      this.fx.update(dt, state);
      this.applyWorldTransform();
    }

    // Living camera: pan/zoom `cameraRoot` toward the pov hero. Runs last so it
    // reads this frame's final hero x. No-op (early return) when the flag is
    // off — `cameraRoot` was already snapped to identity. The existing
    // `cameraPunch` on `world` stays the ONLY punch (no double-punch here).
    this.updateCameraFrame(state, dt);

    // Promoted "โลกมีมิติ" atmosphere (W5): day/night tint, weather, critters.
    // `Date.now()` is the ONE sanctioned wall-clock read in the render layer —
    // a shared accelerated cycle every client samples identically; the
    // deterministic engine never reads it. No-op when disabled (the default).
    this.atmosphere?.update(dt, Date.now(), zone);
  }

  /** Full teardown. Idempotent — safe to call multiple times / before create(). */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.heroPool?.clear();
    this.enemyPool?.clear();
    this.projectilePool?.clear();
    this.ghostLayer?.destroy();
    this.ghostLayer = null;
    this.ghostList = [];
    this.heroPool = null;
    this.enemyPool = null;
    this.projectilePool = null;

    this.atmosphere?.destroy();
    this.atmosphere = null;

    // R4.5 Wave 2C world props: destroyed here as an explicit belt-and-braces
    // teardown (the `app.destroy({children:true})` below would also reap them as
    // `entities` descendants). Reset the rebuild key so a recreate rebuilds.
    for (const v of this.mapPropViews) v.destroy({ children: true });
    this.mapPropViews = [];
    this.mapPropSpecs = [];
    this.mapPropsNear?.destroy({ children: true });
    this.mapPropsNear = null;
    this.mapPropsKey = null;

    this.fx?.destroy();
    this.fx = null;

    if (this.npcViews) {
      for (const view of this.npcViews.values()) view.destroy({ children: true });
      this.npcViews = null;
    }
    this.npcSpeech?.destroy();
    this.npcSpeech = null;

    this.llama?.destroy();
    this.llama = null;

    this.honorBoard?.destroy();
    this.honorBoard = null;

    this.environment?.destroy();
    this.environment = null;

    if (this.bossView) {
      this.bossView.destroy({ children: true });
      this.bossView = null;
    }
    this.currentBossId = null;
    if (this.worldBossView) {
      this.worldBossView.destroy({ children: true });
      this.worldBossView = null;
    }
    this.currentWorldBossId = null;
    this.lastAnchorX = null;
    this.heroDisplayNames = null;
    this.heroSocialBadges = null;
    this.townChampions = null;
    this.bossHpBar = null;
    this.bossLabel = null;
    this.worldBossHpBar = null;
    this.worldBossPlate = null;
    this.worldBossLabel = null;
    // Camera/mask Pixi objects are descendants of `world` (destroyed by
    // `app.destroy({children:true})` below); just drop our references. The
    // persistent `worldFx` seam + its stored flags are intentionally NOT reset
    // (they survive a destroy/recreate, like `povHeroIndex`).
    this.camera = null;
    this.cameraRoot = null;
    this.cameraMask = null;
    this.lastCamTargetX = null;
    this.enemyDepthScratch.clear();
    this.layers = null;
    this.world = null;

    if (this.app) {
      // `removeView: true` detaches the canvas we appended in create();
      // full children/texture cleanup avoids leaking GPU resources on repeated
      // mount/unmount (StrictMode, route changes, etc.).
      this.app.destroy(
        { removeView: true },
        { children: true, texture: true, textureSource: true },
      );
      this.app = null;
    }
  }

  private handleResize(canvasParent: HTMLElement): void {
    if (!this.app || !this.world) return;
    const w = canvasParent.clientWidth;
    const h = canvasParent.clientHeight;
    if (w > 0 && h > 0) {
      this.app.renderer.resize(w, h);
    }
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    // R2.5 "Game Screen" W1: fullscreen (any-aspect) fit — `scale`/`x` are
    // identical to the old `computeWorldTransform`, `y` anchors via
    // `BAND_BIAS` instead of dead-center. `world`'s own local coordinate
    // system (entities, hit-tests, GROUND_Y) is completely unaffected.
    const fs = computeFullscreenTransform(screenW, screenH);
    this.baseTransform = { scale: fs.scale, x: fs.x, y: fs.y };

    // Living-camera view width: on a screen wider than the world's own 3:1
    // aspect, more than WORLD_WIDTH world-units are already visible at once
    // (decorative bleed either side) — feed the camera's clamp math the LIVE
    // value so it never restricts panning as if the screen were still
    // exactly 900 units wide. No-op before `create()`'s camera exists.
    if (this.camera) setViewW(this.camera, fs.viewWorldW);

    // `world.filterArea` (impact filters — shockwave/RGB-split) and the
    // living-camera's clip mask must cover every world-space pixel now
    // visibly on screen (letterbox band PLUS decorative bleed), or a filter
    // trigger / a >1 camera zoom would clip the newly-visible bleed content
    // for that beat. Redrawn every resize (cheap: Rectangle alloc + one
    // Graphics rebuild).
    const rect = computeVisibleWorldRect(screenW, screenH);
    this.world.filterArea = new Rectangle(rect.x, rect.y, rect.width, rect.height);
    this.redrawCameraMask(rect);
    // Tell the impact-filter controller where `filterArea`'s origin now sits
    // (in world-local units) so its shockwave `center` math — calibrated
    // against a filterArea pinned at world's own local origin — stays
    // correct now that the origin can sit at a negative offset (bleed).
    this.fx?.setFilterOrigin(rect.x, rect.y);

    // Scale is fully owned by `applyWorldTransform()` (base * camera-punch),
    // so it's the single source of truth for `world.scale` — called right
    // below, no separate `scale.set()` needed here.
    this.applyWorldTransform();
  }

  /** Redraws `cameraMask` to `rect` (world-local units) — see
   * `handleResize()`. Idempotent no-op before `create()` builds it. */
  private redrawCameraMask(rect: VisibleWorldRect): void {
    if (!this.cameraMask) return;
    this.cameraMask
      .clear()
      .rect(rect.x, rect.y, safeRadius(rect.width), safeRadius(rect.height))
      .fill(0xffffff);
  }

  /**
   * Re-applies `baseTransform` (letterbox) composed with the CURRENT
   * screenshake offset + camera-punch scale/offset to `world` every time any
   * of them changes — an additive/multiplicative compose, NEVER a
   * destructive overwrite of the letterbox transform the resize math owns.
   * Scale: `baseTransform.scale * punchScale`. Position: `baseTransform.xy +
   * shakeOffset + punchOffset`.
   */
  private applyWorldTransform(): void {
    if (!this.world) return;
    const shake = this.fx?.shakeOffset ?? { x: 0, y: 0 };
    const punchScale = this.fx?.punchScale ?? 1;
    const punchOffset = this.fx?.punchOffset ?? { x: 0, y: 0 };
    this.world.scale.set(this.baseTransform.scale * punchScale);
    this.world.position.set(
      this.baseTransform.x + shake.x + punchOffset.x,
      this.baseTransform.y + shake.y + punchOffset.y,
    );
  }

  /**
   * Foot-plant + depth-scale + depth-sort a hero/enemy ROOT view (both take the
   * full depth treatment). The root pivot is `GROUND_Y` (set at pool-create
   * time), so `view.y = footY` renders the feet exactly on the (possibly
   * lifted) ground and the uniform scale grows the rig AROUND the feet. Only
   * `view.y` is overwritten — never `view.x`, which `updateXView` already set
   * to the entity's x + any render lunge. OFF-identity: `footY ≡ GROUND_Y`,
   * `depthScaleOf ≡ 1`, `zIndex 0` (equal → stable sort keeps insertion order).
   */
  private placeActor(view: Container, x: number, d: number): void {
    view.y = this.worldFx.footY(x, d);
    view.scale.set(this.worldFx.depthScaleOf(d));
    view.zIndex = this.worldFxFlags.depth ? depthZIndex(d) : 0;
  }

  /**
   * Foot-plant a boss / world-boss / NPC root view with terrain lift ONLY (no
   * depth scale, no depth zIndex — those get fixed sort keys at creation). Uses
   * `DEPTH_NEUTRAL`, the depth d whose vertical offset is exactly 0, so
   * `footY` collapses to `groundY(x)` whether or not the depth flag is on.
   * OFF-identity: `groundY ≡ GROUND_Y` → `view.y = GROUND_Y`, cancelling the
   * GROUND_Y pivot back to today's rig.
   */
  private placeStaticActor(view: Container, x: number): void {
    view.y = this.worldFx.footY(x, DEPTH_NEUTRAL);
  }

  /**
   * Foot-plant + depth-scale + depth-sort a Wave-2C world prop the SAME way
   * `placeActor` does an actor: invert the prop's `planeY` through
   * `planeToDepth` and run it through the shared `footY`/`depthScaleOf`/
   * `depthZIndex` pipeline, so a prop's foot line and sort key are bit-for-bit
   * the ones an actor standing on the same row gets (actors walk in front of /
   * behind it). OFF-identity (depth flag off): `d = DEPTH_NEUTRAL` → foot at
   * `groundY(x)`, scale 1, `zIndex 0` (equal → insertion order), matching the
   * actors' own flag-off behavior. Baked once at build time (props are static);
   * a flag flip rebuilds via `mapPropsKey`.
   */
  private placeProp(view: Graphics, spec: MapPropSpec): void {
    const depthOn = this.worldFx.depthEnabled();
    const d = depthOn ? planeToDepth(spec.planeY) : DEPTH_NEUTRAL;
    view.x = spec.x;
    view.y = this.worldFx.footY(spec.x, d);
    view.scale.set(this.worldFx.depthScaleOf(d));
    view.zIndex = depthOn ? depthZIndex(d) : 0;
  }

  /**
   * (Re)build the map2-farm world-prop set (`environment/mapProps.ts`) when the
   * zone — or the depth/terrain flags — change; otherwise a cheap key-compare
   * early return (zero per-frame allocation). Standing props are added directly
   * to `entities` (shared actor sort domain, Wave 1.2); the near-layer container
   * frames the near edge. Tearing down/rebuilding here never disturbs the actor
   * pools — `Pool` only sweeps ids IT created (`Pool.ts`), and these are plain
   * siblings.
   */
  private syncMapProps(zone: Zone): void {
    if (!this.layers) return;
    const active = mapPropsActiveForZone(zone);
    const depthOn = this.worldFx.depthEnabled();
    const key = active
      ? `${zone.mapId}:${zone.zoneIdx}:${depthOn ? 1 : 0}:${this.worldFxFlags.terrain ? 1 : 0}`
      : null;
    if (key === this.mapPropsKey) return;

    // Teardown any existing set (removed from `entities`, fully destroyed).
    for (const v of this.mapPropViews) {
      this.layers.entities.removeChild(v);
      v.destroy({ children: true });
    }
    this.mapPropViews = [];
    this.mapPropSpecs = [];
    if (this.mapPropsNear) {
      this.layers.entities.removeChild(this.mapPropsNear);
      this.mapPropsNear.destroy({ children: true });
      this.mapPropsNear = null;
    }
    this.mapPropsKey = key;
    if (!active) return;

    const biome = biomeForZone(zone);
    const built = buildMapProps(
      biome,
      zone,
      (x) => this.worldFx.groundY(x),
      (view, spec) => this.placeProp(view, spec),
    );
    for (const v of built.standing) this.layers.entities.addChild(v);
    this.layers.entities.addChild(built.near);
    this.mapPropViews = built.standing;
    this.mapPropSpecs = built.layout.standing;
    this.mapPropsNear = built.near;
  }

  /** The `cameraRoot`'s live transform for hit-test un-projection (identity
   * when the camera is off / before `create()`). */
  private camView(): CamView {
    const r = this.cameraRoot;
    return r ? { x: r.x, y: r.y, scale: r.scale.x } : { x: 0, y: 0, scale: 1 };
  }

  /** Snap `cameraRoot` back to an identity transform AND detach/hide the clip
   * mask (camera off). Called once on the on→off edge (not per frame), so an
   * off camera costs nothing and clips nothing = pixel-identical to today. */
  private snapCameraIdentity(): void {
    const r = this.cameraRoot;
    if (r) {
      r.scale.set(1);
      r.position.set(0, 0);
      r.mask = null;
    }
    if (this.cameraMask) this.cameraMask.visible = false;
    this.lastCamTargetX = null;
  }

  /** Engage the clip mask (camera on) so a >1.0 zoom can't spill content onto
   * the letterbox bars. Idempotent. */
  private activateCameraMask(): void {
    if (this.cameraRoot && this.cameraMask) {
      this.cameraMask.visible = true;
      this.cameraRoot.mask = this.cameraMask;
    }
  }

  /** Any engaged farm mob / live stage boss / world boss in MY zone = "in a
   * fight" → the camera holds the tight follow-zoom instead of relaxing. */
  private isCombatActive(state: GameState): boolean {
    if (state.boss) return true;
    for (const e of state.enemies) if (e.engaged) return true;
    const wb = state.worldBoss;
    return !!(
      wb &&
      wb.active &&
      wb.entity &&
      state.location.mapId === wb.mapId &&
      state.location.zoneIdx === wb.zoneIdx
    );
  }

  /** Per-frame camera step: follow the pov hero's x (finite-difference vx),
   * hold zoom during combat, apply the transform to `cameraRoot`. No-op when
   * the camera flag is off (identity already snapped). */
  private updateCameraFrame(state: GameState, dt: number): void {
    const cam = this.camera;
    const root = this.cameraRoot;
    if (!cam || !root || !this.worldFxFlags.camera) return;

    const hero = state.heroes[this.povHeroIndex] ?? state.heroes[0] ?? null;
    const x = hero ? hero.x : WORLD_WIDTH / 2;
    // Clamp dt off zero so a paused/first frame can't explode the velocity.
    const camDt = Math.max(1 / 240, dt);
    const vx = this.lastCamTargetX == null ? 0 : (x - this.lastCamTargetX) / camDt;
    this.lastCamTargetX = x;

    // Reset the idle timer BEFORE stepping so combat never relaxes to idleZoom.
    if (this.isCombatActive(state)) cam.idleT = 0;
    updateCamera(cam, { x, vx }, dt);
    cameraTransform(cam, this.camScratch);
    root.scale.set(this.camScratch.scale);
    root.position.set(this.camScratch.posX, this.camScratch.posY);
  }

  /**
   * Manual play (M7.8): convert a canvas-relative pointer position (CSS px —
   * e.g. `clientX/Y` minus the mount element's `getBoundingClientRect()`, see
   * `GameClient.tsx`'s tap handler) into a tap outcome. Monsters win over
   * ground on overlap (checked first). Uses the LETTERBOX transform
   * (`baseTransform`), never the shaking/punching live `world` transform, so
   * a tap target never jitters mid-shake. Entities are effectively 1D on `x`
   * (every view derives its y from `GROUND_Y` + fixed offsets — see
   * `enemyView.ts`'s doc comment), so the hit-test is an x/y ellipse around
   * each enemy's approximate body center, generous enough for a comfortable
   * touch target at any zoom level.
   */
  hitTestPointer(canvasX: number, canvasY: number, state: GameState): PointerHitResult {
    if (!this.app) return null;
    const cam = this.camView();
    // Un-project through the letterbox `baseTransform` THEN the `cameraRoot`
    // (camera inverse). With the camera off (cam = identity) this collapses to
    // today's `(canvas − base.xy)/base.scale`, i.e. bit-identical tap math.
    const w = canvasToWorld(canvasX, canvasY, this.baseTransform, cam, this.hitScratch);
    const wx = w.x;
    const wy = w.y;
    if (wx < 0 || wx > WORLD_WIDTH || wy < 0 || wy > WORLD_HEIGHT) return null;

    // Touch half-extent shrinks by BOTH transforms' scale so the on-screen
    // target stays ~24 CSS px regardless of letterbox fit or camera zoom.
    const touchHalf = TOUCH_HALF_EXTENT_PX / worldScale(this.baseTransform, cam);
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const e of state.enemies) {
      // R4 Wave B: same engine-owned row the draw path uses, so the tap ellipse
      // tracks the rendered feet exactly.
      const d = this.worldFx.depthOf("enemy", e.id, undefined, undefined, e.planeY);
      const scl = this.worldFx.depthScaleOf(d);
      // Ellipse center rides the entity's lifted foot line + depth scale; radii
      // scale with depth too. Flags off → GROUND_Y − 14·size, radii 16/22·size.
      const cy = enemyTapCenterY(e.size, this.worldFx.footY(e.x, d), scl);
      const rx = Math.max(touchHalf, 16 * e.size * scl);
      const ry = Math.max(touchHalf, 22 * e.size * scl);
      const dx = (wx - e.x) / rx;
      const dy = (wy - cy) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        bestId = e.id;
      }
    }
    // WORLD BOSS "เสี่ยจ๋อง": joins the SAME target set as the farm mobs during
    // the battle phase (`getTargets()`/`findById()` in `systems/targeting.ts`/
    // `combat.ts` already include it), so a manual tap-to-attack against it
    // works end-to-end once render recognizes it as a tappable "monster" here
    // — a much bigger touch ellipse than a normal mob, matching its ~2.5x scale.
    const wb = state.worldBoss;
    if (wb && wb.active && wb.entity) {
      const rx = Math.max(touchHalf, WORLD_BOSS_CORE_R * 0.9);
      const ry = Math.max(touchHalf, WORLD_BOSS_CORE_R * 0.9);
      // Terrain lift only (its scale is untouched); flags off → WORLD_BOSS_CY.
      const cy = worldBossTapCenterY(
        WORLD_BOSS_CY,
        this.worldFx.groundY(wb.entity.x) - GROUND_Y,
      );
      const dx = (wx - wb.entity.x) / rx;
      const dy = (wy - cy) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        bestId = wb.entity.id;
      }
    }
    if (bestId !== null) return { kind: "monster", id: bestId };
    // R4 Wave C2 — a ground tap now also carries the DEPTH-ROW it landed on, so the
    // move order can steer the hero's plane (x/y move). Invert the tapped world-y through
    // the SAME `depthOffsetY` forward map (`planeY = wy − groundLine`, clamped to the band):
    // subtract the terrain-lifted ground line at the tapped x (flat/flags-off → GROUND_Y),
    // so only the depth offset remains. A tap above/below the band saturates to the edge row;
    // the engine re-clamps at intake regardless (`systems/manual`).
    const planeY = tapToPlaneY(wy, this.worldFx.groundY(wx), DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR);
    return { kind: "ground", x: wx, planeY };
  }

  /**
   * Town NPCs (M7.x "Town NPCs" task): same canvas-px -> world-space
   * conversion as `hitTestPointer()` above (letterbox `baseTransform`, never
   * the shaking/punching live transform), checked against the fixed
   * `TOWN_NPCS` anchors. Only ever hits while the CURRENT zone is town (the
   * anchors are meaningless positions in any farm/boss zone) — a separate
   * method rather than folded into `hitTestPointer()`'s union, see
   * `NpcHitResult`'s doc comment for why.
   */
  hitTestNpc(canvasX: number, canvasY: number, state: GameState): NpcHitResult {
    if (!this.app) return null;
    if (zoneAt(state.location).kind !== "town") return null;
    // Same camera-aware un-projection as `hitTestPointer` (identical when the
    // camera is off). Town rides a flat camera pan too when the camera is on.
    const cam = this.camView();
    const w = canvasToWorld(canvasX, canvasY, this.baseTransform, cam, this.hitScratch);
    const wx = w.x;
    const wy = w.y;
    if (wx < 0 || wx > WORLD_WIDTH || wy < 0 || wy > WORLD_HEIGHT) return null;

    for (const anchor of TOWN_NPCS) {
      if (Math.abs(wx - anchor.x) <= anchor.radius) return { kind: "npc", id: anchor.id };
    }
    return null;
  }

  /**
   * Zone-edge gate tap (R1 W2 "tappable gates"): same camera-aware
   * canvas->world un-projection as `hitTestPointer`/`hitTestNpc` above,
   * delegated to the pure `gateTapSide()` (`@/render/environment/zoneGates`,
   * headlessly tested) for the actual geometry — a generous rect (≥48
   * world-unit-wide, full arch height) centered on each side's `gateX`.
   * Purely geometric; never reads unlock state (see `GateHitResult`'s doc).
   */
  hitTestGate(canvasX: number, canvasY: number, state: GameState): GateHitResult {
    if (!this.app) return null;
    const zone = zoneAt(state.location);
    const cam = this.camView();
    const w = canvasToWorld(canvasX, canvasY, this.baseTransform, cam, this.hitScratch);
    const wx = w.x;
    const wy = w.y;
    if (wx < 0 || wx > WORLD_WIDTH || wy < 0 || wy > WORLD_HEIGHT) return null;

    const side = gateTapSide(wx, wy, GROUND_Y, zone.mapId, zone.kind);
    return side ? { kind: "gate", side } : null;
  }

  /**
   * Ghost-presence "tap profile" (R3 issue #50 Wave 5): same camera-aware
   * canvas->world un-projection as `hitTestPointer`/`hitTestNpc`/`hitTestGate`
   * above, scanned against THIS FRAME'S ghost render list (`this.ghostList`,
   * fed by `draw()` from `GhostStore.list()` — see `ghostLayer.ts`'s doc for
   * why presence data never reaches the engine). Reuses `enemyTapCenterY`'s
   * ellipse-math SHAPE but with the DEDICATED `GHOST_TAP_*` knobs above
   * (taller + higher-centered than the generic monster ellipse) so the touch
   * target actually covers the tall human rig instead of hugging its ankles.
   * Takes NO `GameState` (unlike the sibling
   * hit-tests): ghost identity lives entirely in `this.ghostList`, which
   * `draw()` already fed from `GhostStore.list()` — presence data never
   * flows through the engine (THE ONE RULE). VIEW-ONLY: never mutates
   * anything, never produces a command — see `GhostHitResult`'s doc.
   */
  hitTestGhost(canvasX: number, canvasY: number): GhostHitResult {
    if (!this.app) return null;
    const cam = this.camView();
    const w = canvasToWorld(canvasX, canvasY, this.baseTransform, cam, this.hitScratch);
    const wx = w.x;
    const wy = w.y;
    if (wx < 0 || wx > WORLD_WIDTH || wy < 0 || wy > WORLD_HEIGHT) return null;

    const touchHalf = TOUCH_HALF_EXTENT_PX / worldScale(this.baseTransform, cam);
    let best: GhostDrawItem | null = null;
    let bestDist = Infinity;
    for (const g of this.ghostList) {
      // R4.5 Wave 1.2 (PR #72 review): the tap ellipse must sit on the SAME row the
      // ghost is DRAWN on — live published `planeY` when present (Wave 1.1), else the
      // engine's shared scatter math (`scatterPlaneY(cid)`). Mirrors ghostLayer.ts's
      // draw-path expression exactly so tap and feet can never disagree.
      const d = this.worldFx.depthOf(
        "ghost",
        g.cid,
        undefined,
        undefined,
        g.planeY ?? scatterPlaneY(g.cid),
      );
      const scl = this.worldFx.depthScaleOf(d);
      const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, this.worldFx.footY(g.x, d), scl);
      const rx = Math.max(touchHalf, GHOST_TAP_RX * scl);
      const ry = Math.max(touchHalf, GHOST_TAP_RY * scl);
      const dx = (wx - g.x) / rx;
      const dy = (wy - cy) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        best = g;
      }
    }
    if (!best) return null;
    return { kind: "ghost", cid: best.cid, name: best.name, cls: best.cls, tier: best.tier };
  }

  /**
   * UI-triggered (a later "ui gating" wave decides WHEN/WHAT text): shows a
   * ~2.5s speech bubble above `npcId`'s head. No-op if `npcId` isn't one of
   * the two built-once town actors (defensive — should never happen given
   * `TownNpcId` is a closed union).
   */
  showNpcSpeech(npcId: TownNpcId, text: string): void {
    const view = this.npcViews?.get(npcId);
    if (!view || !this.npcSpeech) return;
    this.npcSpeech.show(view.headAnchor, text);
  }

  /**
   * M8 party P6 hook: register per-hero display names for the nameplate shown
   * above non-primary heroes (slot !== 0 in `state.heroes`). There is no
   * `Hero.name` field (deliberately — the engine stays untouched by cosmetic
   * identity), so the LATER networking/room wiring calls this whenever cohort
   * membership/names change (e.g. on a peer joining/renaming). Pass `null` to
   * clear every nameplate; a hero id simply absent from the map hides only
   * that hero's nameplate. Safe to call any time (before `create()` resolves,
   * mid-session, or after `destroy()` — the value is just read defensively in
   * `draw()`).
   */
  setHeroDisplayNames(names: ReadonlyMap<number, string> | null): void {
    this.heroDisplayNames = names;
  }

  /**
   * Ghost-presence render seam (docs/ghost-presence-design.md §3.5): the interpolated,
   * capped, deduped list of OTHER players in my zone to draw as walk/idle ghosts below my
   * own heroes. Produced by the ui-side `GhostStore` from the world socket, re-supplied
   * every frame (positions are freshly interpolated). Empty/default = nothing drawn (solo
   * or feature off) — the solo render output is pixel-identical to before this seam. This
   * is a pure DISPLAY feed; it never enters `GameState` (the One Rule, design §2). Safe
   * to call any time; applied in the next `draw()`.
   */
  setGhosts(items: readonly GhostDrawItem[]): void {
    this.ghostList = items;
  }

  /**
   * HOF seasonal rewards (docs/hof-rewards-design.md §3, render wave): registers
   * per-hero-id current-season social badges (title tag text + rank-1 champion
   * gold-aura flag), keyed the same way as `setHeroDisplayNames()` above.
   * `title: null` shows no tag for that hero even if `champion` is true (e.g. an
   * online-time #1, which the design intentionally never gets a title-less
   * aura for either — see `docs/hof-rewards-design.md` §2's "ออนไลน์นานสุด" row).
   * `null`/unset (every existing call site) means no hero ever shows a title
   * tag or champion aura — solo/sim output is unaffected by this seam existing.
   * Safe to call any time (before `create()` resolves, mid-session, or after
   * `destroy()`); forwarded to `FxController.setHeroSocialBadges()` for the
   * continuous aura read, re-applied to a freshly-built `FxController`
   * regardless of call order (same convention as `setPovHeroIndex()`).
   */
  setHeroSocialBadges(
    badges: ReadonlyMap<string, { title: string | null; champion: boolean }> | null,
  ): void {
    this.heroSocialBadges = badges;
    this.fx?.setHeroSocialBadges(badges);
  }

  /**
   * HOF seasonal rewards (docs/hof-rewards-design.md §3 item 3, render wave):
   * registers the current season's town honor-plaque entries (see
   * `TownHonorBoard.setEntries()`'s "never called = pixel-identical" doc
   * comment — the plaque itself stays invisible until this is called at least
   * once, even with `[]`). Safe to call any time (before `create()` resolves,
   * mid-session, or after `destroy()`); re-applied to a freshly-built
   * `honorBoard` in `create()` regardless of call order.
   */
  setTownChampions(entries: readonly TownChampionEntry[]): void {
    this.townChampions = entries;
    this.honorBoard?.setEntries(entries);
  }

  /**
   * M8 party P6 seam (mirrors `setHeroDisplayNames()` above): registers which
   * `state.heroes` slot is the LOCAL point-of-view hero, forwarded to the
   * `FxController` so co-op SCREEN-level skill beats stay personal while
   * world-anchored spectacle stays shared — see `FxController.setPovHeroIndex()`'s
   * doc comment. Safe to call any time (before `create()` resolves, mid-
   * session, or after `destroy()`); the value is stored here and re-applied
   * to a freshly-built `FxController` regardless of call order.
   */
  setPovHeroIndex(index: number): void {
    this.povHeroIndex = index;
    this.fx?.setPovHeroIndex(index);
  }

  /**
   * Promoted "โลกมีมิติ" master switch (settings wave, W6): toggles the depth
   * band + terrain ground (incl. `Environment`'s polygon ground layer) +
   * living camera + atmosphere (day/night tint + weather + critters). Stored
   * (like `setPovHeroIndex`) so a call before `create()` resolves is
   * re-applied to the freshly-built scene. ALL false (the default) = pixel-
   * identical to today: flat ground, no depth, identity camera, no
   * atmosphere, today's tap math. Safe to call any time.
   */
  setWorldFx(flags: {
    depth: boolean;
    terrain: boolean;
    camera: boolean;
    atmosphere: boolean;
  }): void {
    this.worldFxFlags = { ...flags };
    this.worldFx.setFlags({ depth: flags.depth, terrain: flags.terrain });
    this.environment?.setTerrainEnabled(flags.terrain);
    // Camera on → engage the clip mask; off → snap `cameraRoot` to identity and
    // detach the mask ONCE (the per-frame updater early-returns while off).
    if (flags.camera) this.activateCameraMask();
    else this.snapCameraIdentity();
    this.atmosphere?.setEnabled(flags.atmosphere);
  }

  /**
   * Promoted "โลกมีมิติ" atmosphere density (W5 runtime, driven by the
   * ghost-fps valve in W6): 1 = full, 0.5 = reduced (weather dimmed, birds
   * hidden), 0 = hidden (weather/critters/night-overlay off, and
   * `atmosphere.update()` skips its whole per-frame body). Independent of
   * `setWorldFx`'s `atmosphere` on/off flag — only matters once that flag is
   * on. Stored for the same defensive re-apply reason as `worldFxFlags`.
   * Safe to call any time.
   */
  setAtmosphereDensity(s: number): void {
    this.atmosphereDensity = s;
    this.atmosphere?.setDensity(s);
  }

  /** Entity-view lookup for the fx layer's hit-flash (id -> live Pixi view). */
  private getEntityView(target: HitTargetKind, id: number): Container | null {
    if (target === "hero") return this.heroPool?.peek(id) ?? null;
    if (target === "enemy") return this.enemyPool?.peek(id) ?? null;
    // "boss" covers BOTH the stage boss and the world boss (`damage.ts`'s
    // `targetKind()` classifies anything that isn't a hero/enemy as "boss") —
    // the two never coexist, so checking both live-view ids here is safe.
    if (id === this.currentBossId) return this.bossView;
    if (id === this.currentWorldBossId) return this.worldBossView;
    return null;
  }

  private drawBossOverlay(state: GameState): void {
    if (!this.bossHpBar || !this.bossLabel) return;
    const boss = state.phase === "boss" ? state.boss : null;
    this.bossHpBar.visible = !!boss;
    this.bossLabel.visible = !!boss;
    if (!boss) return;

    const bw = safeRadius(WORLD_WIDTH - 120);
    const bx = 60;
    const by = 16;
    const pct = boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;

    this.bossHpBar.clear();
    this.bossHpBar.roundRect(bx, by, bw, 12, 6).fill({ color: 0x000000, alpha: 0.4 });
    this.bossHpBar
      .roundRect(bx, by, safeRadius(bw * pct), 12, 6)
      .fill(boss.enraged ? PALETTE.warn : PALETTE.boss);

    this.bossLabel.text = `บอสด่าน ${state.stage}${boss.enraged ? "  ⚡ENRAGED" : ""}`;
    this.bossLabel.position.set(bx, by - 16);
  }

  /**
   * WORLD BOSS "เสี่ยจ๋อง" overlay: a gold-trimmed nameplate backdrop + a WIDE
   * gold HP bar, visually distinct from `drawBossOverlay()`'s stage-boss bar
   * (never shown at the same time — see the field doc comment). The name is a
   * hardcoded Thai literal, matching this same file's existing convention for
   * `bossLabel.text` above (`บอสด่าน ${stage}`) — stage-boss names aren't i18n'd
   * through a UI-layer string table either, so no new naming seam was needed
   * (there is no `Hero.name`-style field to source it from on the engine side;
   * `WorldBossState` carries no display string).
   */
  private drawWorldBossOverlay(state: GameState): void {
    if (!this.worldBossHpBar || !this.worldBossPlate || !this.worldBossLabel) return;
    const wb = state.worldBoss;
    const visible =
      !!wb &&
      wb.active &&
      !!wb.entity &&
      state.location.mapId === wb.mapId &&
      state.location.zoneIdx === wb.zoneIdx;
    this.worldBossHpBar.visible = visible;
    this.worldBossPlate.visible = visible;
    this.worldBossLabel.visible = visible;
    if (!visible || !wb || !wb.entity) return;
    const boss = wb.entity;

    const bw = safeRadius(WORLD_WIDTH - 120);
    const bx = 60;
    // by 16 -> 24: the gold nameplate sits ABOVE this bar (plateY = by - plateH - 2);
    // at by=16 that put the plate at world y=-4, clipped past the canvas top -> the
    // boss NAME overflowed the screen (owner report 2026-07-08). 24 keeps plate y=2.
    const by = 24;
    const bh = 16; // taller than the stage boss's 12px bar — reads as "bigger"
    const pct = boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;

    this.worldBossHpBar.clear();
    this.worldBossHpBar.roundRect(bx, by, bw, bh, 6).fill({ color: 0x000000, alpha: 0.45 });
    this.worldBossHpBar
      .roundRect(bx, by, safeRadius(bw * pct), bh, 6)
      .fill(boss.enraged ? PALETTE.warn : PALETTE.worldBossGold);
    this.worldBossHpBar
      .roundRect(bx, by, bw, bh, 6)
      .stroke({ width: 2, color: PALETTE.worldBossPlateGold, alpha: 0.85 });

    // Gold-trimmed nameplate backdrop behind the label.
    const plateW = 96;
    const plateH = 18;
    const plateX = bx;
    const plateY = by - plateH - 2;
    this.worldBossPlate.clear();
    this.worldBossPlate
      .roundRect(plateX, plateY, plateW, plateH, 5)
      .fill({ color: PALETTE.worldBossGoldDark, alpha: 0.85 });
    this.worldBossPlate
      .roundRect(plateX, plateY, plateW, plateH, 5)
      .stroke({ width: 1.5, color: PALETTE.worldBossPlateGold, alpha: 0.9 });

    this.worldBossLabel.text = `เสี่ยจ๋อง${boss.enraged ? "  ⚡" : ""}`;
    this.worldBossLabel.position.set(plateX + 6, plateY + 2);
  }
}

/**
 * Probe for a usable WebGL2 context. Pixi v8's WebGL renderer requires WebGL2
 * (WebGL1 is unsupported); older/low-end mobile browsers, or a device under
 * memory pressure, can fail to create one. WebGL is NOT a secure-context-gated
 * API, so this works identically on http:// LAN/Tailscale origins and https://.
 */
function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}
