/**
 * `/lab` Pixi bootstrap — a thin, standalone mirror of the init/resize/destroy
 * idiom in `src/render/GameRenderer.ts`'s `create()` (copied on purpose, NOT
 * imported — that class's `draw()` wants a full engine `GameState`, which the
 * lab has no business constructing just to preview a hand-drawn sprite).
 *
 * Contract:
 *   const stage = await createLabStage(mountEl);   // once, client-only
 *   stage.world                                     // draw experiments into this
 *   stage.destroy();                                // on unmount / experiment switch
 *
 * Same logical coordinate space as the real game (`WORLD_WIDTH x WORLD_HEIGHT`,
 * ground at `GROUND_Y` — all re-exported from `@/render/layout`, a READ-ONLY
 * import) so a sprite previewed here sits at the same scale/ground line it
 * would in the real arena.
 */

import { Application, Container, Graphics, Rectangle } from "pixi.js";
import {
  computeWorldTransform,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldTransform,
} from "@/render/layout";

export interface LabStage {
  app: Application;
  /** Logical `WORLD_WIDTH x WORLD_HEIGHT` root, letterboxed/scaled to fit the
   * mount element — draw experiment scenes into this, never `app.stage`
   * directly (keeps the same ground-relative coordinate space every
   * experiment + `@/render` view/scene builder already assumes). */
  world: Container;
  /** Re-derive the letterbox transform (rarely needed manually — a
   * ResizeObserver already calls this on layout change). */
  handleResize(): void;
  /** Idempotent full teardown — safe to call more than once. */
  destroy(): void;
}

/** Probe for a usable WebGL2 context (Pixi v8's WebGL renderer requires it) —
 * verbatim copy of `GameRenderer.ts`'s own probe so a lab visit on an
 * unsupported device fails with a clear, catchable error too. */
function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

/** Sets up a fresh Pixi `Application` inside `canvasParent`, letterboxed into
 * the shared logical world space. Client-only (call from a `useEffect`). */
export async function createLabStage(canvasParent: HTMLElement): Promise<LabStage> {
  if (!isWebGL2Available()) {
    throw new Error("อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ WebGL2 ซึ่งจำเป็นต่อการเรนเดอร์ lab");
  }

  const app = new Application();
  await app.init({
    backgroundColor: 0x0c0f1a,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: "webgl",
  });
  canvasParent.appendChild(app.canvas);

  const world = new Container();
  world.filterArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  app.stage.addChild(world);

  let baseTransform: WorldTransform = { scale: 1, x: 0, y: 0 };
  function applyTransform(): void {
    world.scale.set(baseTransform.scale);
    world.position.set(baseTransform.x, baseTransform.y);
  }

  function handleResize(): void {
    const w = canvasParent.clientWidth;
    const h = canvasParent.clientHeight;
    if (w > 0 && h > 0) app.renderer.resize(w, h);
    baseTransform = computeWorldTransform(app.screen.width, app.screen.height);
    applyTransform();
  }

  // Same ResizeObserver-on-the-mount-element idiom as GameRenderer (a plain
  // `window.resize` listener misses sidebar/flex-driven reflows).
  const resizeObserver = new ResizeObserver(() => handleResize());
  resizeObserver.observe(canvasParent);
  handleResize();

  let destroyed = false;
  return {
    app,
    world,
    handleResize,
    destroy(): void {
      // Idempotent — safe to call twice (covers React StrictMode's dev
      // mount/unmount/mount double-invoke, same guarantee GameRenderer gives).
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    },
  };
}

/** A tileable checkerboard `Graphics`, the neutral (no-biome) backdrop for
 * experiments ① animPlayer and ④ juice, and the "isolate the sprite" toggle
 * inside ②/③'s biome-backed scenes. Flat two-tone fill only (footgun 3: no
 * hand-built canvas gradients here either). */
export function buildCheckerboard(
  width: number,
  height: number,
  cell = 24,
  colorA = 0x1a2036,
  colorB = 0x222b48,
): Graphics {
  const g = new Graphics();
  for (let y = 0; y * cell < height; y++) {
    for (let x = 0; x * cell < width; x++) {
      const even = (x + y) % 2 === 0;
      g.rect(x * cell, y * cell, cell, cell).fill(even ? colorA : colorB);
    }
  }
  return g;
}
