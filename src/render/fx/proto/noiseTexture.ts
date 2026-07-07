/**
 * PROTO ONLY (`/proto-shaders`) — a tiny procedurally-baked blotch texture used
 * as a `DisplacementFilter` map (`heatHaze.ts`). Built via Pixi `Graphics` +
 * `renderer.generateTexture()`, never a hand-built canvas gradient (POC-bug
 * rule #2 / CLAUDE.md #3) — same technique `groundBand.ts`'s baked speckle
 * texture already uses elsewhere in this codebase, just imported here as a
 * pattern, not the code itself (this file is additive-only, nothing existing
 * changed).
 *
 * The RNG here is a tiny local LCG, deterministic and cosmetic-only — it never
 * touches the engine's seeded RNG stream (that stream is reserved for wave
 * composition per CLAUDE.md).
 */

import { Graphics, type Renderer, type Texture } from "pixi.js";

const NOISE_SIZE = 128;
const BLOB_COUNT = 420;

/** Build a small tileable-ish blotch texture, alpha-only (white blobs, varying
 * alpha) — good enough for a displacement map's "how much/which direction"
 * signal. Not a real Perlin/simplex field, but plenty for a proto shimmer. */
export function buildNoiseTexture(renderer: Renderer): Texture {
  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 10000) / 10000;
  };

  const g = new Graphics();
  // Base mid-gray fill so the displacement map has a non-zero neutral point
  // (pure transparent = no signal at all, which reads as "half the texture
  // does nothing").
  g.rect(0, 0, NOISE_SIZE, NOISE_SIZE).fill({ color: 0x808080, alpha: 1 });
  for (let i = 0; i < BLOB_COUNT; i++) {
    const x = rand() * NOISE_SIZE;
    const y = rand() * NOISE_SIZE;
    const r = 1.5 + rand() * 5;
    const v = rand();
    g.circle(x, y, r).fill({ color: v > 0.5 ? 0xffffff : 0x000000, alpha: 0.35 + v * 0.25 });
  }

  const texture = renderer.generateTexture({ target: g, resolution: 1 });
  g.destroy();
  texture.source.addressMode = "repeat";
  return texture;
}
