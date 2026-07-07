/**
 * PROTO ONLY (`/proto-shaders`) — hell-city ember glow-grade, effect #3: a
 * warm `AdjustmentFilter` color lift (contrast + a red/green push, no blue)
 * stacked with the SAME `AdvancedBloomFilter` factory the real game already
 * uses (`@/render/fx/impactFilters`'s `createBloomFilter()` — imported
 * read-only, nothing there changes), tuned conservatively per footgun #10
 * (additive/bright fx must not white-out a scene — a high `threshold` keeps
 * only the biome's own bright ember accents blooming, everything else
 * untouched).
 */

import { AdjustmentFilter } from "pixi-filters";
import { createBloomFilter } from "@/render/fx/impactFilters";
import type { Filter } from "pixi.js";

export class EmberGlowGradeEffect {
  private readonly grade = new AdjustmentFilter({
    gamma: 1,
    contrast: 1,
    saturation: 1,
    brightness: 1,
    red: 1,
    green: 1,
    blue: 1,
  });
  private readonly bloom = createBloomFilter();
  private strength = 0.5;

  setStrength(strength01: number): void {
    this.strength = Math.max(0, Math.min(1, strength01));
    const s = this.strength;
    // Warm push: lift red/contrast, hold green, gently pull blue down — a
    // GRADE, not a full tint wash (stays subtle at s=0, visibly warmer at s=1).
    this.grade.contrast = 1 + 0.18 * s;
    this.grade.saturation = 1 + 0.12 * s;
    this.grade.red = 1 + 0.14 * s;
    this.grade.green = 1 + 0.03 * s;
    this.grade.blue = 1 - 0.1 * s;
    // Bloom scales in lockstep with the grade so "off" is truly off (0 blur
    // contribution), not a fixed bloom the grade slider can't reach.
    this.bloom.bloomScale = 0.5 + 0.6 * s;
    this.bloom.brightness = 1 + 0.1 * s;
  }

  /** Halve the (already-cheap) resolution of both passes for the "low-power"
   * toggle — a fullscreen-pass cost is the thing that scales with device tier. */
  setLowPower(lowPower: boolean): void {
    const res = lowPower ? 0.5 : 1;
    this.grade.resolution = res;
    this.bloom.resolution = res;
  }

  /** This effect never assigns `target.filters` directly — `ProtoShaderStage`
   * composes it alongside the generic per-biome color grade on the SAME root
   * container, so it just hands back its own filter pair to be concatenated. */
  filters(enabled: boolean): Filter[] {
    return enabled ? [this.grade, this.bloom] : [];
  }

  destroy(): void {
    this.grade.destroy();
    this.bloom.destroy();
  }
}
