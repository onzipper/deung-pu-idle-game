/**
 * PROTO ONLY — `/proto-shaders`'s standalone Pixi mount. NOT part of the real
 * game render pipeline (`GameRenderer.ts` is untouched); this is a throwaway
 * experiment so the owner can judge Pixi filters/shaders in-browser before
 * they become part of the sanctioned visual language. Deleting the whole
 * `src/render/fx/proto/` + `src/app/proto-shaders/` folders removes this
 * entirely (M6.5 `/proto` precedent).
 *
 * Reuses the REAL biome scenery (`BiomeScene`/`biomeForZone`, read-only
 * imports, nothing in `environment/` changes) for three zones — one per map
 * the owner wants judged (map4 ice tundra, map5 desert ruins, map6 hell
 * city) — and layers four independently-toggleable effects on top:
 *
 *  1. Desert heat haze (map5)   — `heatHaze.ts`, a band-clipped `DisplacementFilter`.
 *  2. Tundra aurora (map4)      — `aurora.ts`, layered sine-wave ribbons (color, not a filter).
 *  3. Hell ember glow-grade (map6) — `emberGrade.ts`, warm `AdjustmentFilter` + the
 *     real game's own `createBloomFilter()` (imported, never re-implemented).
 *  4. Global per-biome color grade (all 3) — `colorGrade.ts`, a single cheap
 *     `AdjustmentFilter` preset, to show how much a grade ALONE buys.
 *
 * FILTER COMPOSITION NOTE: a Pixi `Container` has exactly ONE `.filters` array
 * + ONE `.filterArea`. Heat haze needs a band-clipped `filterArea`; the ember
 * grade + generic color grade need the FULL scene area. So they live on two
 * different containers: `sceneLayer` (holds the live `BiomeScene.view`, and is
 * the one heat haze clips) vs `stageRoot` (wraps `sceneLayer`, and is where
 * ember-grade/color-grade compose together, unclipped). Aurora is not a
 * filter at all — a `Container` of its own ribbons, added as a sibling on top
 * of the scene.
 */

import { Application, Container, Rectangle, type Renderer } from "pixi.js";
import { zoneAt, initGameState, type GameState, type Zone } from "@/engine";
import { biomeForZone } from "@/render/environment/biomes";
import { BiomeScene } from "@/render/environment/BiomeScene";
import { computeWorldTransform, GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { PALETTE } from "@/render/theme";
import { HeatHazeEffect } from "@/render/fx/proto/heatHaze";
import { AuroraEffect } from "@/render/fx/proto/aurora";
import { EmberGlowGradeEffect } from "@/render/fx/proto/emberGrade";
import { ColorGradeEffect } from "@/render/fx/proto/colorGrade";

export type ProtoSceneId = "map4" | "map5" | "map6";

/** Mid farm zone (not the last one — sidesteps the boss-door-unlock lookup
 * entirely, this is scenery-only) per map, per the task brief. */
const SCENE_LOCATION: Record<ProtoSceneId, { mapId: string; zoneIdx: number }> = {
  map4: { mapId: "map4", zoneIdx: 2 },
  map5: { mapId: "map5", zoneIdx: 2 },
  map6: { mapId: "map6", zoneIdx: 2 },
};

export interface ProtoToggles {
  /** The scene's own dedicated effect (haze / aurora / ember-glow). */
  primary: boolean;
  /** Generic per-biome color grade (effect #4). */
  colorGrade: boolean;
  /** Halves filter resolution — the "cheaper on mobile" knob. */
  lowPower: boolean;
}

export interface ProtoStrengths {
  primary: number;
  colorGrade: number;
}

const DEFAULT_TOGGLES: ProtoToggles = { primary: true, colorGrade: false, lowPower: false };
const DEFAULT_STRENGTHS: ProtoStrengths = { primary: 0.6, colorGrade: 0.6 };

export class ProtoShaderStage {
  private app: Application | null = null;
  /** Full-area container: ember-grade + generic color-grade compose here. */
  private stageRoot: Container | null = null;
  /** Band-clippable container: heat haze's `filterArea` lives here, and it's
   * the direct parent of the live `BiomeScene.view`. */
  private sceneLayer: Container | null = null;
  private auroraLayer: Container | null = null;
  private scene: BiomeScene | null = null;
  private zone: Zone | null = null;
  private state: GameState | null = null;
  private sceneId: ProtoSceneId = "map5";

  private heatHaze: HeatHazeEffect | null = null;
  private aurora: AuroraEffect | null = null;
  private emberGrade: EmberGlowGradeEffect | null = null;
  private colorGrade: ColorGradeEffect | null = null;

  private toggles: ProtoToggles = { ...DEFAULT_TOGGLES };
  private strengths: ProtoStrengths = { ...DEFAULT_STRENGTHS };

  private resizeObserver: ResizeObserver | null = null;
  private baseTransform = { scale: 1, x: 0, y: 0 };
  private lastMs = 0;
  private fps = 60;
  private tickerCb: ((ticker: { deltaMS: number }) => void) | null = null;

  async create(canvasParent: HTMLElement): Promise<void> {
    if (this.app) this.destroy();

    const app = new Application();
    await app.init({
      backgroundColor: PALETTE.arenaSky,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
    this.app = app;
    canvasParent.appendChild(app.canvas);

    const stageRoot = new Container();
    stageRoot.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    app.stage.addChild(stageRoot);
    this.stageRoot = stageRoot;

    const sceneLayer = new Container();
    sceneLayer.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    stageRoot.addChild(sceneLayer);
    this.sceneLayer = sceneLayer;

    const auroraLayer = new Container();
    stageRoot.addChild(auroraLayer);
    this.auroraLayer = auroraLayer;

    this.heatHaze = new HeatHazeEffect(
      app.renderer as Renderer,
      new Rectangle(0, GROUND_Y - 70, WORLD_WIDTH, 90),
    );
    this.heatHaze.attachTo(sceneLayer);
    this.aurora = new AuroraEffect(WORLD_WIDTH, 0, GROUND_Y * 0.55);
    auroraLayer.addChild(this.aurora.view);
    this.emberGrade = new EmberGlowGradeEffect();
    this.colorGrade = new ColorGradeEffect();

    this.setScene(this.sceneId);

    this.resizeObserver = new ResizeObserver(() => this.handleResize(canvasParent));
    this.resizeObserver.observe(canvasParent);
    this.handleResize(canvasParent);

    this.lastMs = performance.now();
    this.tickerCb = () => this.tick();
    app.ticker.add(this.tickerCb);
  }

  setScene(id: ProtoSceneId): void {
    if (!this.sceneLayer) return;
    this.sceneId = id;
    const loc = SCENE_LOCATION[id];
    this.state = initGameState(1);
    this.state.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    this.zone = zoneAt(this.state.location);
    const resolved = biomeForZone(this.zone);

    this.scene?.destroy();
    this.scene = new BiomeScene(resolved, this.zone, this.state);
    this.sceneLayer.addChild(this.scene.view);
    if (this.auroraLayer) this.auroraLayer.visible = id === "map4";
    this.colorGrade?.setScene(id);
    this.composeFilters();
  }

  setToggle<K extends keyof ProtoToggles>(key: K, value: ProtoToggles[K]): void {
    this.toggles[key] = value;
    if (key === "lowPower") {
      this.heatHaze?.setLowPower(!!value);
      this.colorGrade?.setLowPower(!!value);
    }
    this.composeFilters();
  }

  setStrength<K extends keyof ProtoStrengths>(key: K, value: ProtoStrengths[K]): void {
    this.strengths[key] = value;
    if (key === "primary") {
      this.heatHaze?.setStrength(value);
      this.aurora?.setStrength(value);
    } else if (key === "colorGrade") {
      this.colorGrade?.setStrength(value);
    }
  }

  getToggles(): ProtoToggles {
    return { ...this.toggles };
  }

  getFps(): number {
    return this.fps;
  }

  /** Recompute which filters live on which container from the current
   * scene + toggle state (see the class doc comment's composition note). */
  private composeFilters(): void {
    if (!this.sceneLayer || !this.stageRoot || !this.heatHaze || !this.emberGrade || !this.colorGrade) {
      return;
    }
    // Heat haze OWNS sceneLayer.filters/filterArea outright — only meaningful
    // on the desert scene.
    this.heatHaze.apply(this.sceneLayer, this.sceneId === "map5" && this.toggles.primary);

    // stageRoot composes ember-glow-grade (map6 only, effect #3) + the
    // generic per-biome color grade (effect #4, any scene) together.
    const emberOn = this.sceneId === "map6" && this.toggles.primary;
    const gradeOn = this.toggles.colorGrade;
    const filters = [...this.emberGrade.filters(emberOn), ...(gradeOn ? [this.colorGrade.filter] : [])];
    this.stageRoot.filters = filters.length ? filters : null;
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastMs) / 1000));
    this.lastMs = now;
    if (dt > 0) {
      const instFps = 1 / dt;
      this.fps = this.fps + (instFps - this.fps) * 0.1;
    }

    if (this.scene && this.state && this.zone) {
      this.scene.update(dt, 0.35, this.state);
    }
    this.heatHaze?.update(dt);
    if (this.sceneId === "map4") this.aurora?.update(dt);
  }

  private handleResize(canvasParent: HTMLElement): void {
    if (!this.app || !this.stageRoot) return;
    const w = canvasParent.clientWidth;
    const h = canvasParent.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this.baseTransform = computeWorldTransform(this.app.screen.width, this.app.screen.height);
    this.stageRoot.scale.set(this.baseTransform.scale);
    this.stageRoot.position.set(this.baseTransform.x, this.baseTransform.y);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.app && this.tickerCb) this.app.ticker.remove(this.tickerCb);
    this.tickerCb = null;

    this.scene?.destroy();
    this.scene = null;
    this.heatHaze?.destroy();
    this.heatHaze = null;
    this.aurora?.destroy();
    this.aurora = null;
    this.emberGrade?.destroy();
    this.emberGrade = null;
    this.colorGrade?.destroy();
    this.colorGrade = null;

    this.stageRoot = null;
    this.sceneLayer = null;
    this.auroraLayer = null;

    if (this.app) {
      this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
  }
}
