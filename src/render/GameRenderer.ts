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
import { zoneAt } from "@/engine";
import type { GameEvent, HitTargetKind } from "@/engine/state";
import type { GameState } from "@/engine/state";
import { Pool } from "@/render/Pool";
import { Environment } from "@/render/environment/Environment";
import { FxController } from "@/render/fx/FxController";
import { RENDER_FX } from "@/render/fxConfig";
import { createBloomFilter } from "@/render/fx/impactFilters";
import {
  computeWorldTransform,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldTransform,
} from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";
import { createBossView, updateBossView, type BossView } from "@/render/views/bossView";
import {
  createEnemyView,
  updateEnemyView,
  type EnemyView,
} from "@/render/views/enemyView";
import { createHeroView, updateHeroView, type HeroView } from "@/render/views/heroView";
import {
  createProjectileView,
  updateProjectileView,
  type ProjectileView,
} from "@/render/views/projectileView";

/**
 * Manual play (M7.8) tap outcome: a live enemy id (monsters WIN over ground
 * on overlap) or a raw world-x ground tap (the engine itself clamps
 * `moveTo.x` to the zone's walkable bounds — see `systems/manual.ts` — so this
 * just reports the world position under the pointer). `null` for a tap
 * outside the logical world rect (the letterbox bars).
 */
export type PointerHitResult = { kind: "monster"; id: number } | { kind: "ground"; x: number } | null;

/** Minimum on-screen touch half-extent (CSS px, NOT world units) a monster
 * hit-test guarantees regardless of the current letterbox scale — the task's
 * "≥24px half-extent on mobile" requirement. Converted to world units per-call
 * via the live `baseTransform.scale` (see `hitTestPointer()`). */
const TOUCH_HALF_EXTENT_PX = 24;

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
  private enemyPool: Pool<EnemyView> | null = null;
  private projectilePool: Pool<ProjectileView> | null = null;
  private bossView: BossView | null = null;
  private bossHpBar: Graphics | null = null;
  private bossLabel: Text | null = null;
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
    // Pin the filter-coordinate space to `world`'s own local (logical) origin
    // — see `fx/impactFilters.ts`'s doc comment for exactly why this makes
    // the shockwave filter's world-coord -> filter-space mapping a plain
    // multiply-by-scale instead of manual bounds/toGlobal bookkeeping, and
    // why it stays correct across resizes with zero extra work here.
    world.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    app.stage.addChild(world);
    this.world = world;

    const background = new Container();
    const entities = new Container();
    const projectiles = new Container();
    const fx = new Container();
    const overlay = new Container();
    world.addChild(background, entities, projectiles, fx, overlay);
    this.layers = { background, entities, projectiles, fx, overlay };

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

    this.heroPool = new Pool(entities, createHeroView);
    this.enemyPool = new Pool(entities, createEnemyView);
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

    this.fx = new FxController(
      fx,
      world,
      (target, id) => this.getEntityView(target, id),
      (id) => this.heroPool?.peek(id) ?? null,
    );

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

    this.environment?.update(dt, state);

    const marching = this.lastAnchorX != null && state.anchorX > this.lastAnchorX + 1e-3;
    this.lastAnchorX = state.anchorX;

    const heroPool = this.heroPool;
    heroPool.beginFrame();
    state.heroes.forEach((h, slot) => {
      updateHeroView(heroPool.get(h.id), h, { dt, slot, events: frameEvents, marching });
    });
    heroPool.endFrame();

    // Enemies list is empty during the boss phase (the sim clears it on entry).
    // M7.9 "new mob species": resolved from the CURRENT zone, same
    // `zoneAt(state.location).mapId` plumbing as the boss theme below — safe
    // because it's only read once, at a view's first-sight `buildRig()` (an
    // enemy never changes map mid-life).
    const enemyMapId = zoneAt(state.location).mapId;
    this.enemyPool.beginFrame();
    for (const e of state.enemies) {
      updateEnemyView(this.enemyPool.get(e.id), e, { dt, events: frameEvents, mapId: enemyMapId });
    }
    this.enemyPool.endFrame();

    if (state.boss) {
      if (!this.bossView) {
        this.bossView = createBossView();
        this.layers.entities.addChild(this.bossView);
      }
      // M7.9 "Grand Expansion": the boss entity itself is map-agnostic (see
      // `engine/entities/index.ts`'s `Boss`), so the per-boss silhouette/
      // palette theme is resolved here from the CURRENT zone instead — valid
      // because `state.boss` is only ever non-null while standing in that
      // map's boss room (see `engine/systems/world.ts`).
      const mapId = zoneAt(state.location).mapId;
      updateBossView(this.bossView, state.boss, { elapsedMs, dt, events: frameEvents, mapId });
      this.currentBossId = state.boss.id;
    } else if (this.bossView) {
      this.layers.entities.removeChild(this.bossView);
      this.bossView.destroy({ children: true });
      this.bossView = null;
      this.currentBossId = null;
    }
    this.drawBossOverlay(state);

    this.projectilePool.beginFrame();
    for (const p of state.projectiles) {
      updateProjectileView(this.projectilePool.get(p.id), p, state);
    }
    this.projectilePool.endFrame();

    // fx: entity views for this frame all exist by now, so hit-flash lookups
    // (by id) resolve correctly even for entities that just spawned.
    if (this.fx) {
      if (frameEvents.length) this.fx.consumeEvents(frameEvents, state);
      this.fx.update(dt, state);
      this.applyWorldTransform();
    }
  }

  /** Full teardown. Idempotent — safe to call multiple times / before create(). */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.heroPool?.clear();
    this.enemyPool?.clear();
    this.projectilePool?.clear();
    this.heroPool = null;
    this.enemyPool = null;
    this.projectilePool = null;

    this.fx?.destroy();
    this.fx = null;

    this.environment?.destroy();
    this.environment = null;

    if (this.bossView) {
      this.bossView.destroy({ children: true });
      this.bossView = null;
    }
    this.currentBossId = null;
    this.lastAnchorX = null;
    this.bossHpBar = null;
    this.bossLabel = null;
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
    this.baseTransform = computeWorldTransform(
      this.app.screen.width,
      this.app.screen.height,
    );
    // Scale is fully owned by `applyWorldTransform()` (base * camera-punch),
    // so it's the single source of truth for `world.scale` — called right
    // below, no separate `scale.set()` needed here.
    this.applyWorldTransform();
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
    const t = this.baseTransform;
    const wx = (canvasX - t.x) / t.scale;
    const wy = (canvasY - t.y) / t.scale;
    if (wx < 0 || wx > WORLD_WIDTH || wy < 0 || wy > WORLD_HEIGHT) return null;

    const touchHalf = TOUCH_HALF_EXTENT_PX / t.scale;
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const e of state.enemies) {
      const rx = Math.max(touchHalf, 16 * e.size);
      const ry = Math.max(touchHalf, 22 * e.size);
      const dx = (wx - e.x) / rx;
      const dy = (wy - (GROUND_Y - 14 * e.size)) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && dist < bestDist) {
        bestDist = dist;
        bestId = e.id;
      }
    }
    if (bestId !== null) return { kind: "monster", id: bestId };
    return { kind: "ground", x: wx };
  }

  /** Entity-view lookup for the fx layer's hit-flash (id -> live Pixi view). */
  private getEntityView(target: HitTargetKind, id: number): Container | null {
    if (target === "hero") return this.heroPool?.peek(id) ?? null;
    if (target === "enemy") return this.enemyPool?.peek(id) ?? null;
    return id === this.currentBossId ? this.bossView : null;
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
