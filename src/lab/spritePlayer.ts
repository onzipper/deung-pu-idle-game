/**
 * Shared frame-stepping engine for a drawn sprite — every `/lab` experiment
 * that shows the loaded `FrameSet` playing (all four do) wraps one of these
 * instead of re-deriving fps/scale/flip/step logic per experiment. Not part
 * of the registry contract (`LabScene`) — a plain internal helper class.
 *
 * Deliberately hand-rolled frame stepping (a plain `Sprite` + manual texture
 * swap in `update(dt)`) rather than Pixi's own `AnimatedSprite`, which drives
 * itself off `Ticker.shared` — that would double-drive against `LabScreen`'s
 * own rAF loop and fight the pause/step controls.
 */

import { Sprite } from "pixi.js";
import type { FrameSet } from "@/lab/frames";

export class FramePlayer {
  readonly sprite = new Sprite();
  private readonly frames: FrameSet;
  private index = 0;
  private acc = 0;
  private fps = 8;
  private playing = true;
  private flip = false;
  private baseScale = 2;

  constructor(frames: FrameSet) {
    this.frames = frames;
    this.sprite.anchor.set(0.5, 1);
    this.applyTexture();
    this.applyTransform();
  }

  private applyTexture(): void {
    const f = this.frames.frames[this.index];
    if (f) this.sprite.texture = f.texture;
  }

  private applyTransform(): void {
    this.sprite.scale.set(this.baseScale * (this.flip ? -1 : 1), this.baseScale);
  }

  setFps(fps: number): void {
    this.fps = Math.max(0.5, fps);
  }
  getFps(): number {
    return this.fps;
  }

  setScale(scale: number): void {
    this.baseScale = Math.max(0.1, scale);
    this.applyTransform();
  }
  getScale(): number {
    return this.baseScale;
  }

  setFlip(flip: boolean): void {
    this.flip = flip;
    this.applyTransform();
  }
  getFlip(): boolean {
    return this.flip;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }
  isPlaying(): boolean {
    return this.playing;
  }

  get frameCount(): number {
    return this.frames.frames.length;
  }
  get frameIndex(): number {
    return this.index;
  }
  get frameName(): string | null {
    return this.frames.frames[this.index]?.name ?? null;
  }

  /** Manual single-frame step, works whether playing or paused — `delta` is
   * a signed step count (+1 next, -1 previous). */
  step(delta: number): void {
    const n = this.frames.frames.length;
    if (n === 0) return;
    this.index = (((this.index + delta) % n) + n) % n;
    this.applyTexture();
  }

  update(dt: number): void {
    const n = this.frames.frames.length;
    if (n <= 1 || !this.playing) return;
    this.acc += dt;
    const frameDur = 1 / this.fps;
    // Bounded catch-up (a stalled tab could otherwise loop here for a long
    // time) — at most a handful of frame-advances per tick.
    let guard = 0;
    while (this.acc >= frameDur && guard < 8) {
      this.acc -= frameDur;
      this.index = (this.index + 1) % n;
      guard++;
    }
    this.applyTexture();
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
