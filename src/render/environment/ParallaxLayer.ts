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
 *
 * Optional `conformY` (W3 "โลกมีมิติ" ground promotion): given a chunk's
 * CURRENT local center x (this layer's own coordinate space — the caller maps
 * it to world x, see `BiomeScene`'s near-props call site), returns the y that
 * chunk's origin should sit at. Applied once at build time AND again after
 * every `update()` scroll/wrap step, so a chunk conforming to sloped terrain
 * tracks it automatically as it scrolls (and re-teleports) — a handful of
 * pure calls per frame, zero allocation. Omitted (undefined, the default) =
 * today's behavior byte-identical: `chunk.position.y` is whatever `build()`
 * left it (Pixi defaults a fresh Container to 0) and this class never touches
 * it.
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
    private readonly conformY?: (localCenterX: number) => number,
  ) {
    this.totalWidth = chunkWidth * count;
    this.chunks = Array.from({ length: count }, (_, i) => {
      const chunk = build(i);
      chunk.position.x = i * chunkWidth;
      if (this.conformY) chunk.position.y = this.conformY(chunk.position.x + chunkWidth / 2);
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
      if (this.conformY) chunk.position.y = this.conformY(chunk.position.x + this.chunkWidth / 2);
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
