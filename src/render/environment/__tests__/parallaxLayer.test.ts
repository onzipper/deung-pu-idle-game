/**
 * `ParallaxLayer`'s optional `conformY` vertical-conform hook (W3 "โลกมีมิติ"
 * ground promotion) — decoupled from `BiomeScene`/terrain specifics so this
 * pins the primitive's own contract: applied once at chunk-build time, then
 * re-applied after every `update()` scroll step (including a wrap-around
 * teleport), using each chunk's CURRENT local center x. Omitting `conformY`
 * entirely must leave `chunk.position.y` exactly as `build()` left it
 * (today's behavior, byte-identical) — `BiomeScene`'s near-props call site is
 * the only production caller that ever supplies one, for its terrain-
 * tracking ground props (see that file + `groundBand.ts`).
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { ParallaxLayer } from "@/render/environment/ParallaxLayer";

describe("ParallaxLayer — no conformY (default) leaves chunk.position.y untouched", () => {
  it("stays at Pixi's default 0 through build and several update() ticks", () => {
    const layer = new ParallaxLayer(80, 4, () => new Container());
    for (const chunk of layer.view.children) expect(chunk.position.y).toBe(0);

    layer.update(1 / 60, 40);
    layer.update(1 / 60, 40);
    for (const chunk of layer.view.children) expect(chunk.position.y).toBe(0);

    layer.destroy();
  });
});

describe("ParallaxLayer — optional conformY", () => {
  it("applies at build time: each chunk's y = conformY(its own local center x)", () => {
    const chunkWidth = 100;
    const count = 3;
    const conformY = (localCenterX: number) => localCenterX * 2 + 5;
    const layer = new ParallaxLayer(chunkWidth, count, () => new Container(), conformY);

    const children = layer.view.children;
    expect(children.length).toBe(count);
    for (let i = 0; i < count; i++) {
      const expectedX = i * chunkWidth;
      expect(children[i]!.position.x).toBe(expectedX);
      expect(children[i]!.position.y).toBeCloseTo(conformY(expectedX + chunkWidth / 2));
    }

    layer.destroy();
  });

  it("re-applies after every update() scroll step, tracking the CURRENT local center x", () => {
    const chunkWidth = 100;
    const count = 3;
    // A simple deterministic "slope": y rises 0.5px per local-x px.
    const conformY = (localCenterX: number) => localCenterX * 0.5;
    const layer = new ParallaxLayer(chunkWidth, count, () => new Container(), conformY);

    layer.update(1, 30); // dt=1s, speed=30 world-px/s -> each chunk.x -= 30
    for (const chunk of layer.view.children) {
      expect(chunk.position.y).toBeCloseTo(conformY(chunk.position.x + chunkWidth / 2));
    }

    layer.update(1, 30);
    for (const chunk of layer.view.children) {
      expect(chunk.position.y).toBeCloseTo(conformY(chunk.position.x + chunkWidth / 2));
    }

    layer.destroy();
  });

  it("stays correct across a wrap-around teleport (conformY reads the POST-wrap x)", () => {
    const chunkWidth = 50;
    const count = 3; // totalWidth = 150
    const conformY = (localCenterX: number) => 100 - localCenterX; // any non-trivial fn
    const layer = new ParallaxLayer(chunkWidth, count, () => new Container(), conformY);

    // Scroll far enough (> totalWidth) to force every chunk through a wrap.
    for (let i = 0; i < 5; i++) layer.update(1, 40); // 5 * 40 = 200px of scroll
    for (const chunk of layer.view.children) {
      expect(chunk.position.x).toBeGreaterThan(-chunkWidth); // never left stranded off-band
      expect(chunk.position.y).toBeCloseTo(conformY(chunk.position.x + chunkWidth / 2));
    }

    layer.destroy();
  });
});
