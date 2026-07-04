/**
 * Transient, ATTACH-ONLY-WHILE-ACTIVE Pixi filters on the whole `world`
 * container — `ShockwaveFilter` (meteor/skill-AOE impact + boss-slam-land
 * ripple) and `RGBSplitFilter` (a ~80ms "took a big hit" sting on
 * `heroDown`) — plus a small factory for the persistent `AdvancedBloomFilter`
 * (see `GameRenderer.create()`).
 *
 * All three come from `pixi-filters` (the official v8-compatible filter
 * collection) — never hand-built shaders/gradients (the POC-bug rule).
 * Filters cost GPU time even when idle if left attached, so — same
 * discipline as `hitFlash.ts` — `world.filters` is only ever non-null while
 * at least one of shockwave/RGB-split is mid-flight; the instant both finish,
 * it goes back to `null` (idle steady-state GPU cost: zero). Bloom is the one
 * exception: it's requested as a PERSISTENT filter on `projectiles`/`fx`, so
 * its kill-switch is `RENDER_FX.bloom` (see `fxConfig.ts`), not a timer.
 *
 * Coordinate mapping: `GameRenderer.create()` sets `world.filterArea` once to
 * the fixed WORLD-space rect `(0, 0, WORLD_WIDTH, WORLD_HEIGHT)`. Pixi's
 * filter system computes a display object's filter region as
 * `filterArea` transformed by that object's OWN worldTransform (see
 * `getFastGlobalBoundsMixin`/`FilterSystem._calculateFilterArea` — it treats
 * `filterArea` as local-space and applies the container's full transform to
 * get the global filter-texture bounds). Pinning it to `world`'s own local
 * origin means the filter-space origin always lands exactly on `world`'s
 * letterboxed top-left, so a WORLD-space impact point maps to filter-space
 * with nothing more than a multiply by the live letterbox scale
 * (`world.scale.x` — translation cancels out because both share the same
 * origin by construction). No manual `toGlobal`/bounds bookkeeping needed,
 * and it stays correct across resizes automatically since scale is read
 * fresh at each trigger.
 */

import type { Container, Filter } from "pixi.js";
import { AdvancedBloomFilter, RGBSplitFilter, ShockwaveFilter } from "pixi-filters";

// ---- Shockwave (meteor/skill-AOE impact, boss-slam-land) -------------------
// Spatial knobs are expressed in WORLD units (the same space engine
// coordinates live in) and multiplied by the live letterbox scale at trigger
// time, so the ripple's apparent size stays consistent across canvas sizes.
const SHOCKWAVE_DURATION = 0.4; // real seconds the ripple is visible, per spec
const SHOCKWAVE_RADIUS_WORLD = 220; // max ripple radius
const SHOCKWAVE_WAVELENGTH_WORLD = 60;
const SHOCKWAVE_SPEED_WORLD = 900; // ripple expansion speed, world px/s
const SHOCKWAVE_AMPLITUDE_WORLD = 10; // pixel-displacement strength
const SHOCKWAVE_BRIGHTNESS = 1.05;

// ---- RGB split ("took a big hit" sting on heroDown) ------------------------
const RGB_SPLIT_DURATION = 0.08; // ~80ms, per spec
const RGB_SPLIT_OFFSET = 3; // px — deliberately small/subtle, not a glitch effect

export class ImpactFilterController {
  private readonly shockwave = new ShockwaveFilter({ brightness: SHOCKWAVE_BRIGHTNESS });
  private readonly rgbSplit = new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 } });

  private shockwaveActive = false;
  private shockwaveT = 0;
  private rgbSplitActive = false;
  private rgbSplitT = 0;
  /** Set whenever the ACTIVE SET (not the per-frame uniform values) changes —
   * `world.filters` is only reassigned then, never every frame. */
  private dirty = false;

  constructor(private readonly world: Container) {}

  /** Fire the shockwave centered on a WORLD-space impact point. */
  triggerShockwave(worldX: number, worldY: number): void {
    const scale = this.world.scale.x;
    this.shockwave.center = { x: worldX * scale, y: worldY * scale };
    this.shockwave.radius = SHOCKWAVE_RADIUS_WORLD * scale;
    this.shockwave.wavelength = SHOCKWAVE_WAVELENGTH_WORLD * scale;
    this.shockwave.speed = SHOCKWAVE_SPEED_WORLD * scale;
    this.shockwave.amplitude = SHOCKWAVE_AMPLITUDE_WORLD * scale;
    this.shockwave.time = 0;
    this.shockwaveT = SHOCKWAVE_DURATION;
    if (!this.shockwaveActive) {
      this.shockwaveActive = true;
      this.dirty = true;
    }
  }

  /** Fire the ~80ms RGB-split hit sting (whole-world, no position needed). */
  triggerRgbSplit(): void {
    this.rgbSplitT = RGB_SPLIT_DURATION;
    if (!this.rgbSplitActive) {
      this.rgbSplitActive = true;
      this.dirty = true;
    }
  }

  /** Advance both timers by `dt` REAL seconds; (de)attach `world.filters`
   * only on an active-SET change (never every frame while idle or while the
   * set is merely fading in place). */
  update(dt: number): void {
    if (this.shockwaveActive) {
      this.shockwave.time += dt;
      this.shockwaveT -= dt;
      if (this.shockwaveT <= 0) {
        this.shockwaveActive = false;
        this.dirty = true;
      }
    }
    if (this.rgbSplitActive) {
      this.rgbSplitT -= dt;
      if (this.rgbSplitT <= 0) {
        this.rgbSplitActive = false;
        this.rgbSplit.red = { x: 0, y: 0 };
        this.rgbSplit.green = { x: 0, y: 0 };
        this.dirty = true;
      } else {
        // Fade the split magnitude out over its short life — a softer tail
        // instead of a hard cut at 80ms.
        const off = RGB_SPLIT_OFFSET * (this.rgbSplitT / RGB_SPLIT_DURATION);
        this.rgbSplit.red = { x: -off, y: 0 };
        this.rgbSplit.green = { x: off, y: 0 };
      }
    }
    if (this.dirty) {
      this.dirty = false;
      const active: Filter[] = [];
      if (this.shockwaveActive) active.push(this.shockwave);
      if (this.rgbSplitActive) active.push(this.rgbSplit);
      this.world.filters = active.length ? active : null;
    }
  }

  /** Full teardown (renderer destroy). */
  destroy(): void {
    this.world.filters = null;
    this.shockwave.destroy();
    this.rgbSplit.destroy();
  }
}

// ---- Bloom (persistent, projectiles + fx layers only) ---------------------
// High threshold: only genuinely bright fx accent colors (skill/gold/impact
// hues) bloom — ordinary sprite/UI brightness stays untouched, per spec
// ("subtle... only bright effect colors bloom").
const BLOOM_THRESHOLD = 0.75;
const BLOOM_SCALE = 0.9;
const BLOOM_BRIGHTNESS = 1.0;
const BLOOM_BLUR = 4;

/**
 * One shared `AdvancedBloomFilter` instance for both the `projectiles` and
 * `fx` layers (see `GameRenderer.create()`) — a single instance is safe to
 * assign to two containers' `.filters` because Pixi applies filters
 * sequentially per-container during the render pass (never concurrently), and
 * it halves the GPU/texture-pool cost versus one instance per layer.
 */
export function createBloomFilter(): AdvancedBloomFilter {
  return new AdvancedBloomFilter({
    threshold: BLOOM_THRESHOLD,
    bloomScale: BLOOM_SCALE,
    brightness: BLOOM_BRIGHTNESS,
    blur: BLOOM_BLUR,
  });
}
