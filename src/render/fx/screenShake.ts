/**
 * Screenshake: an additive offset on top of the `world` container's normal
 * letterbox transform — never a destructive overwrite of it. `GameRenderer`
 * re-applies `baseTransform + shakeOffset` every draw() call, so the shake
 * always composes cleanly with resize and never drifts.
 *
 * Amplitude decays exponentially (real-time, not sub-step-count), matching
 * the task's "exponential decay" spec. A retrigger while already shaking takes
 * the MAX of the two amplitudes rather than summing, so a burst of hits can't
 * runaway-accumulate into a nauseating shake.
 */

/** Amplitude below this is treated as fully settled (snap to exactly 0). */
const REST_EPSILON = 0.05;

/** Per-second exponential decay rate (larger = shake settles faster). */
const DECAY_RATE = 9;

export class ScreenShake {
  private amplitude = 0;
  private angle = Math.random() * Math.PI * 2;

  /** Kick the shake to (at least) `amountPx` of amplitude. */
  trigger(amountPx: number): void {
    this.amplitude = Math.max(this.amplitude, amountPx);
  }

  /** Advance decay by `dt` real seconds. */
  update(dt: number): void {
    if (this.amplitude <= REST_EPSILON) {
      this.amplitude = 0;
      return;
    }
    this.amplitude *= Math.exp(-DECAY_RATE * dt);
    if (this.amplitude <= REST_EPSILON) this.amplitude = 0;
    // Rotate the shake direction briskly so it reads as a "shake", not a
    // single directional shove that just eases out.
    this.angle += dt * 55;
  }

  get offset(): { x: number; y: number } {
    if (this.amplitude <= 0) return { x: 0, y: 0 };
    return {
      x: Math.cos(this.angle) * this.amplitude,
      y: Math.sin(this.angle * 1.3) * this.amplitude,
    };
  }
}
