/**
 * The Pixi render layer's public entry point.
 *
 * Lifecycle contract (driven by the integration layer, NOT by this class):
 *   const renderer = new GameRenderer();
 *   await renderer.create(canvasParent);   // once, client-only (e.g. in a useEffect)
 *   renderer.draw(state);                  // every rAF, reading the engine's GameState
 *   renderer.destroy();                    // on unmount — safe to call even if
 *                                           // create() never resolved, and safe to
 *                                           // call create() again afterwards
 *                                           // (covers React StrictMode's mount/
 *                                           // unmount/mount dev double-invoke).
 *
 * One-way data flow: `draw()` only reads `GameState` fields and mutates Pixi
 * display objects. It never mutates `state` and never calls back into `@/engine`.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import type { GameState } from "@/engine/state";
import { Pool } from "@/render/Pool";
import {
  computeWorldTransform,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
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

interface Layers {
  /** Static sky/ground/grid, drawn once. */
  background: Container;
  /** Heroes, enemies, boss. */
  entities: Container;
  projectiles: Container;
  /** Reserved for M4 (particles/screenshake/hit-flash filters) — empty for now. */
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
    canvasParent.appendChild(app.canvas);

    const world = new Container();
    app.stage.addChild(world);
    this.world = world;

    const background = new Container();
    const entities = new Container();
    const projectiles = new Container();
    const fx = new Container();
    const overlay = new Container();
    world.addChild(background, entities, projectiles, fx, overlay);
    this.layers = { background, entities, projectiles, fx, overlay };

    drawBackground(background);

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

    // Pixi's built-in `resizeTo` only reacts to `window` resize events; a
    // ResizeObserver on the actual mount element is what makes layout-driven
    // (not just viewport) resizes (sidebar toggles, flex reflow, etc.) safe.
    this.resizeObserver = new ResizeObserver(() => this.handleResize(canvasParent));
    this.resizeObserver.observe(canvasParent);
    this.handleResize(canvasParent);
  }

  /** One-way read of engine state -> Pixi display objects. Call every rAF. */
  draw(state: GameState): void {
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

    this.heroPool.beginFrame();
    for (const h of state.heroes) updateHeroView(this.heroPool.get(h.id), h);
    this.heroPool.endFrame();

    // Enemies list is empty during the boss phase (the sim clears it on entry).
    this.enemyPool.beginFrame();
    for (const e of state.enemies) updateEnemyView(this.enemyPool.get(e.id), e);
    this.enemyPool.endFrame();

    if (state.boss) {
      if (!this.bossView) {
        this.bossView = createBossView();
        this.layers.entities.addChild(this.bossView);
      }
      updateBossView(this.bossView, state.boss, elapsedMs);
    } else if (this.bossView) {
      this.layers.entities.removeChild(this.bossView);
      this.bossView.destroy({ children: true });
      this.bossView = null;
    }
    this.drawBossOverlay(state);

    this.projectilePool.beginFrame();
    for (const p of state.projectiles) {
      updateProjectileView(this.projectilePool.get(p.id), p, state);
    }
    this.projectilePool.endFrame();
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

    if (this.bossView) {
      this.bossView.destroy({ children: true });
      this.bossView = null;
    }
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
    const t = computeWorldTransform(this.app.screen.width, this.app.screen.height);
    this.world.scale.set(t.scale);
    this.world.position.set(t.x, t.y);
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

/** Sky + ground fill + a faint diagonal grid on the ground (POC `render()` top). */
function drawBackground(container: Container): void {
  const g = new Graphics();
  const margin = 20;
  g.rect(-margin, -margin, WORLD_WIDTH + margin * 2, WORLD_HEIGHT + margin * 2).fill(
    PALETTE.arenaSky,
  );
  g.rect(
    -margin,
    GROUND_Y,
    WORLD_WIDTH + margin * 2,
    safeRadius(WORLD_HEIGHT - GROUND_Y + margin * 2),
  ).fill(PALETTE.arenaGround);
  for (let gx = 0; gx < WORLD_WIDTH; gx += 40) {
    g.moveTo(gx, GROUND_Y)
      .lineTo(gx - 18, WORLD_HEIGHT)
      .stroke({ width: 1, color: PALETTE.gridLine, alpha: 0.05 });
  }
  container.addChild(g);
}
