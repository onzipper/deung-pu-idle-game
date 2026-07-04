/**
 * Generic id-keyed display-object pool.
 *
 * Entities (heroes/enemies/projectiles) appear and disappear every frame as the
 * sim runs; we must never rebuild the Pixi scene graph from scratch each
 * `draw()`. `Pool` keeps one Container per still-alive entity id, creating it on
 * first sight and destroying it once its id no longer appears in the frame's
 * entity list — a simple mark-and-sweep.
 */

import type { Container } from "pixi.js";

export class Pool<V extends Container> {
  private readonly live = new Map<number, V>();
  private readonly seen = new Set<number>();

  constructor(
    private readonly layer: Container,
    private readonly factory: () => V,
  ) {}

  /** Call once at the start of each `draw()` before touching this pool. */
  beginFrame(): void {
    this.seen.clear();
  }

  /** Get (or lazily create) the view for `id`. Marks it as present this frame. */
  get(id: number): V {
    this.seen.add(id);
    let view = this.live.get(id);
    if (!view) {
      view = this.factory();
      this.live.set(id, view);
      this.layer.addChild(view);
    }
    return view;
  }

  /** Call once at the end of each `draw()` — sweeps ids not seen this frame. */
  endFrame(): void {
    for (const [id, view] of this.live) {
      if (!this.seen.has(id)) {
        this.layer.removeChild(view);
        view.destroy({ children: true });
        this.live.delete(id);
      }
    }
  }

  /** Full teardown (renderer destroy / React StrictMode unmount). */
  clear(): void {
    for (const view of this.live.values()) {
      this.layer.removeChild(view);
      view.destroy({ children: true });
    }
    this.live.clear();
    this.seen.clear();
  }
}
