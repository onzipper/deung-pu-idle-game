/**
 * Generic horizontally-wrapping parallax strip.
 *
 * Builds a fixed ring of chunk `Container`s ONCE (via the caller's `build`
 * callback) and forever after only repositions them — never rebuilds
 * Graphics per frame. Chunks scroll left at `speed` world-px/real-second and
 * "recycle": once a chunk's right edge passes the left edge of the visible
 * strip, it is shifted `chunkWidth * count` px to the right, i.e. teleported
 * to the back of the queue. With enough chunks to cover the visible width
 * plus one spare, this reads as an infinite tiling scroll with zero
 * allocation in steady state.
 */

import { Container } from "pixi.js";

export class ParallaxLayer {
  readonly view = new Container();
  private readonly chunks: Container[];
  private readonly totalWidth: number;

  constructor(
    private readonly chunkWidth: number,
    count: number,
    build: (index: number) => Container,
  ) {
    this.totalWidth = chunkWidth * count;
    this.chunks = Array.from({ length: count }, (_, i) => {
      const chunk = build(i);
      chunk.position.x = i * chunkWidth;
      this.view.addChild(chunk);
      return chunk;
    });
  }

  /** Advance the scroll by `dt` real seconds at `speed` world-px/second. */
  update(dt: number, speed: number): void {
    const delta = speed * dt;
    for (const chunk of this.chunks) {
      chunk.position.x -= delta;
      if (chunk.position.x <= -this.chunkWidth) {
        chunk.position.x += this.totalWidth;
      }
    }
  }

  /** Shift every chunk's scroll phase together (kept for a future "snap to
   * biome start" need); unused today but cheap to keep symmetric with update. */
  reset(): void {
    this.chunks.forEach((chunk, i) => {
      chunk.position.x = i * this.chunkWidth;
    });
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
