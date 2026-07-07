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
 * different containers per side: `sceneLayerRight` (holds the live NEW
 * `BiomeScene.view`, and is the one heat haze clips) vs `rightRoot` (wraps
 * `sceneLayerRight` + the aurora overlay, and is where ember-grade/color-grade
 * compose together, unclipped).
 *
 * OLD-vs-NEW COMPARE MODE: two FULLY SEPARATE `BiomeScene` instances
 * (`sceneLeft`/`sceneRight`), both built from the exact same resolved biome +
 * zone + fake state and ticked with the IDENTICAL `dt` every frame — so their
 * deterministic geometry (parallax offsets, gate props, sine-wave-driven
 * silhouettes) stays pixel-identical between the two; only cosmetic
 * ambient-particle spawn timing can drift a little (each `AmbientField` owns
 * its own `Math.random()` stream — acceptable, it's dust/motes, not the
 * effect being compared). `sceneLeft` NEVER receives a filter/aurora — it's
 * the permanent "เดิม" (raw) baseline. `sceneRight` is where every toggle
 * above actually applies — the "ใหม่" (new) side. Avoids the alternative of
 * rendering the world once and re-rendering a `RenderTexture` snapshot through
 * a second filter pass every frame (an extra full-screen GPU readback per
 * frame); duplicating the (cheap, ambient-only) scene update is far less work
 * than that would be.
 *
 * The right side is clipped to "right of the divider" via a plain `Graphics`
 * mask (`dividerMask`) redrawn (never re-transformed) in absolute SCREEN
 * pixels whenever the divider moves or the canvas resizes — since it's never
 * added to the display list, its own transform stays identity, so screen-px
 * geometry IS its global geometry, no extra bookkeeping needed. In full-screen
 * mode the mask simply covers the whole canvas (new-only, matching the
 * pre-compare-mode behavior byte-for-byte).
 */

import { Application, Container, Graphics, Rectangle, type Renderer } from "pixi.js";
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

  /** Left ("เดิม") side — permanently raw, never filtered/decorated. */
  private leftRoot: Container | null = null;
  private sceneLayerLeft: Container | null = null;
  private sceneLeft: BiomeScene | null = null;

  /** Right ("ใหม่") side — every toggle in `ProtoToggles` applies here. */
  private rightRoot: Container | null = null;
  private sceneLayerRight: Container | null = null;
  private auroraLayer: Container | null = null;
  private sceneRight: BiomeScene | null = null;

  /** Screen-space rect mask clipping `rightRoot` to "right of the divider"
   * (or the whole canvas in full-screen mode) — see class doc comment. */
  private dividerMask: Graphics | null = null;

  private zone: Zone | null = null;
  private state: GameState | null = null;
  private sceneId: ProtoSceneId = "map5";

  private heatHaze: HeatHazeEffect | null = null;
  private aurora: AuroraEffect | null = null;
  private emberGrade: EmberGlowGradeEffect | null = null;
  private colorGrade: ColorGradeEffect | null = null;

  private toggles: ProtoToggles = { ...DEFAULT_TOGGLES };
  private strengths: ProtoStrengths = { ...DEFAULT_STRENGTHS };

  /** Compare-mode state: split (default) shows both halves; full-screen shows
   * only the "ใหม่" side (the pre-compare-mode look). `dividerFrac` is the
   * split position, 0..1 of the canvas width. */
  private compareMode = true;
  private dividerFrac = 0.5;

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

    // ---- Left ("เดิม", raw) --------------------------------------------
    const leftRoot = new Container();
    app.stage.addChild(leftRoot);
    this.leftRoot = leftRoot;
    const sceneLayerLeft = new Container();
    leftRoot.addChild(sceneLayerLeft);
    this.sceneLayerLeft = sceneLayerLeft;

    // ---- Right ("ใหม่", every toggle applies) ---------------------------
    const rightRoot = new Container();
    rightRoot.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    app.stage.addChild(rightRoot);
    this.rightRoot = rightRoot;

    const sceneLayerRight = new Container();
    sceneLayerRight.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    rightRoot.addChild(sceneLayerRight);
    this.sceneLayerRight = sceneLayerRight;

    const auroraLayer = new Container();
    rightRoot.addChild(auroraLayer);
    this.auroraLayer = auroraLayer;

    // Standalone (never added to the display list) — a mask object doesn't
    // need to be a scene child, and staying detached is exactly what keeps
    // its own transform at identity (see class doc comment).
    this.dividerMask = new Graphics();
    rightRoot.mask = this.dividerMask;

    this.heatHaze = new HeatHazeEffect(
      app.renderer as Renderer,
      new Rectangle(0, GROUND_Y - 70, WORLD_WIDTH, 90),
    );
    this.heatHaze.attachTo(sceneLayerRight);
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
    if (!this.sceneLayerLeft || !this.sceneLayerRight) return;
    this.sceneId = id;
    const loc = SCENE_LOCATION[id];
    this.state = initGameState(1);
    this.state.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    this.zone = zoneAt(this.state.location);
    const resolved = biomeForZone(this.zone);

    this.sceneLeft?.destroy();
    this.sceneRight?.destroy();
    // Two independent instances from the SAME resolved biome/zone/state —
    // ticked identically every frame (see `tick()`), never sharing a
    // container (a Pixi display object can only have one parent).
    this.sceneLeft = new BiomeScene(resolved, this.zone, this.state);
    this.sceneRight = new BiomeScene(resolved, this.zone, this.state);
    this.sceneLayerLeft.addChild(this.sceneLeft.view);
    this.sceneLayerRight.addChild(this.sceneRight.view);
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

  /** [เทียบครึ่งจอ | เต็มจอ] — full-screen shows ONLY the "ใหม่" (right/new)
   * side across the whole canvas, matching the pre-compare-mode look. */
  setCompareMode(enabled: boolean): void {
    this.compareMode = enabled;
    this.redrawDividerMask();
  }

  /** 0..1 fraction of canvas width where the divider sits (drag or the
   * accessible range-input fallback both funnel through here). */
  setDividerFraction(frac: number): void {
    this.dividerFrac = Math.max(0, Math.min(1, frac));
    this.redrawDividerMask();
  }

  getToggles(): ProtoToggles {
    return { ...this.toggles };
  }

  getFps(): number {
    return this.fps;
  }

  /** Recompute which filters live on which container from the current
   * scene + toggle state (see the class doc comment's composition note).
   * ONLY ever touches the right ("ใหม่") side — left stays permanently raw. */
  private composeFilters(): void {
    if (
      !this.sceneLayerRight ||
      !this.rightRoot ||
      !this.heatHaze ||
      !this.emberGrade ||
      !this.colorGrade
    ) {
      return;
    }
    // Heat haze OWNS sceneLayerRight.filters/filterArea outright — only
    // meaningful on the desert scene.
    this.heatHaze.apply(this.sceneLayerRight, this.sceneId === "map5" && this.toggles.primary);

    // rightRoot composes ember-glow-grade (map6 only, effect #3) + the
    // generic per-biome color grade (effect #4, any scene) together.
    const emberOn = this.sceneId === "map6" && this.toggles.primary;
    const gradeOn = this.toggles.colorGrade;
    const filters = [...this.emberGrade.filters(emberOn), ...(gradeOn ? [this.colorGrade.filter] : [])];
    this.rightRoot.filters = filters.length ? filters : null;
  }

  /** Redraw the screen-space divider mask (see class doc comment for why
   * this Graphics is never added to the display list). Cheap (one rect) —
   * safe to call on every drag/resize/mode-toggle event. */
  private redrawDividerMask(): void {
    if (!this.app || !this.dividerMask) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const splitX = this.compareMode ? w * this.dividerFrac : 0;
    this.dividerMask.clear();
    this.dividerMask.rect(splitX, 0, Math.max(0, w - splitX), h).fill({ color: 0xffffff, alpha: 1 });
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastMs) / 1000));
    this.lastMs = now;
    if (dt > 0) {
      const instFps = 1 / dt;
      this.fps = this.fps + (instFps - this.fps) * 0.1;
    }

    // Same dt fed to both sides in the same tick — deterministic geometry
    // (parallax/gate/sine-wave silhouettes) stays synchronized between
    // "เดิม" and "ใหม่" (see class doc comment on ambient-particle drift).
    if (this.sceneLeft && this.sceneRight && this.state) {
      this.sceneLeft.update(dt, 0.35, this.state);
      this.sceneRight.update(dt, 0.35, this.state);
    }
    this.heatHaze?.update(dt);
    if (this.sceneId === "map4") this.aurora?.update(dt);
  }

  private handleResize(canvasParent: HTMLElement): void {
    if (!this.app || !this.leftRoot || !this.rightRoot) return;
    const w = canvasParent.clientWidth;
    const h = canvasParent.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this.baseTransform = computeWorldTransform(this.app.screen.width, this.app.screen.height);
    for (const root of [this.leftRoot, this.rightRoot]) {
      root.scale.set(this.baseTransform.scale);
      root.position.set(this.baseTransform.x, this.baseTransform.y);
    }
    this.redrawDividerMask();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.app && this.tickerCb) this.app.ticker.remove(this.tickerCb);
    this.tickerCb = null;

    this.sceneLeft?.destroy();
    this.sceneLeft = null;
    this.sceneRight?.destroy();
    this.sceneRight = null;
    this.heatHaze?.destroy();
    this.heatHaze = null;
    this.aurora?.destroy();
    this.aurora = null;
    this.emberGrade?.destroy();
    this.emberGrade = null;
    this.colorGrade?.destroy();
    this.colorGrade = null;
    this.dividerMask?.destroy();
    this.dividerMask = null;

    this.leftRoot = null;
    this.sceneLayerLeft = null;
    this.rightRoot = null;
    this.sceneLayerRight = null;
    this.auroraLayer = null;

    if (this.app) {
      this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
  }
}
