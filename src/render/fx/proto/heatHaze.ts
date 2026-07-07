/**
 * PROTO ONLY (`/proto-shaders`) — desert heat-haze shimmer, effect #1 of the
 * shader showcase. A `DisplacementFilter` (pixi.js core) restricted to a thin
 * band above the ground/horizon via `filterArea` (same "clip the filter to a
 * region" trick `impactFilters.ts`'s shockwave/RGB-split use on the whole
 * `world` — imported nowhere here, just the same established pattern).
 *
 * The displacement SPRITE must stay in the scene graph for its transform to
 * update each frame (a Pixi filter footgun distinct from this repo's own
 * POC-bug list) — added to `view` at effectively-zero alpha rather than left
 * fully outside the tree.
 */

import { Container, DisplacementFilter, Rectangle, Sprite, type Renderer } from "pixi.js";
import { buildNoiseTexture } from "@/render/fx/proto/noiseTexture";

const MAX_DISPLACEMENT_PX = 26;

export class HeatHazeEffect {
  readonly filter: DisplacementFilter;
  private readonly sprite: Sprite;
  private t = 0;
  private strength = 0.5;

  constructor(renderer: Renderer, private readonly bandArea: Rectangle) {
    const texture = buildNoiseTexture(renderer);
    this.sprite = new Sprite(texture);
    this.sprite.scale.set(2.2);
    this.sprite.alpha = 0.001; // present in the tree (transform updates), invisible on screen
    this.filter = new DisplacementFilter({ sprite: this.sprite, scale: 0 });
  }

  /** Add the (invisible) displacement sprite to the scene graph once. */
  attachTo(container: Container): void {
    container.addChild(this.sprite);
  }

  setStrength(strength01: number): void {
    this.strength = Math.max(0, Math.min(1, strength01));
  }

  /** Apply/clear the filter + its band-clipped `filterArea` on the target.
   * This effect OWNS `target.filters`/`filterArea` outright (band-clipped
   * displacement can't share a container with an unclipped filter — see
   * `ProtoShaderStage`'s doc comment on filter composition), so it is only
   * ever called on `scene.view` for the desert scene. */
  apply(target: Container, enabled: boolean): void {
    if (!enabled) {
      target.filters = null;
      target.filterArea = undefined;
      return;
    }
    target.filterArea = this.bandArea;
    target.filters = [this.filter];
  }

  setLowPower(lowPower: boolean): void {
    this.filter.resolution = lowPower ? 0.5 : 1;
  }

  update(dt: number): void {
    this.t += dt;
    // Slow horizontal drift + a gentle vertical breathe — reads as rising
    // heat, not a glitch/earthquake.
    this.sprite.position.x = this.t * 10;
    this.sprite.position.y = Math.sin(this.t * 0.5) * 6;
    const amt = MAX_DISPLACEMENT_PX * this.strength;
    this.filter.scale.set(amt, amt * 0.35);
  }

  destroy(): void {
    this.filter.destroy();
    this.sprite.destroy();
  }
}
