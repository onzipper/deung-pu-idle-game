/**
 * TimeDirector — hit-stop + slow-mo shaping for the fixed-timestep accumulator.
 *
 * This is a pure "wall-clock shaper" that lives OUTSIDE the engine: it never
 * touches `GameState`, never changes `step()` sequencing, and is not part of
 * the deterministic simulation. It only decides, frame to frame, how much of
 * this frame's REAL elapsed seconds get handed to `drainAccumulator()` — i.e.
 * how many fixed sub-steps the sim advances this rAF tick.
 *
 * Two mechanisms, both driven by last frame's `GameEvent`s (see the "one frame
 * of latency" note below):
 *
 *  - HIT-STOP: a full freeze of sim time. While frozen, the shaped output is
 *    0 (or the small leftover after the freeze drains mid-frame) — the engine
 *    doesn't step, but rendering/fx/audio/UI-sync keep running on REAL elapsed
 *    time (GameClient never restricts those), so the freeze reads as "impact
 *    punch" rather than a stutter.
 *  - SLOW-MO: a time-SCALE (< 1) applied to the elapsed seconds fed to the
 *    accumulator, held for a duration, then eased back to 1x.
 *
 * Overlap policy: a new trigger only REPLACES the current effect if it is
 * "stronger" — for hit-stop, a longer remaining freeze; for slow-mo, a lower
 * scale (or, at equal scale, more remaining time). Hit-stop takes precedence
 * over slow-mo: while a freeze is draining, the slow-mo clock does not tick
 * (it resumes exactly where it left off once the freeze ends).
 *
 * LATENCY: `GameEvent`s are produced by the engine's `step()` and only known
 * to the host AFTER stepping, so `shape()` is called with the PREVIOUS
 * frame's event batch. This gives triggers a one-frame latency, which is
 * standard for this kind of juice and deliberately not "fixed" here.
 *
 * Player speed (1x/2x/3x) is orthogonal: it still multiplies inside
 * `drainAccumulator(acc, frameTime, speed)` exactly as before. TimeDirector
 * only shapes the raw `frameTime` input; it has no notion of speed itself.
 */

import type { GameEvent } from "@/engine";

// ---------------------------------------------------------------------------
// Knobs — all hit-stop/slow-mo durations and scales live here.
// (Render-side juice knobs, e.g. screenshake magnitude, live in `@/render`
// and are owned by a different agent — do not add them here.)
// ---------------------------------------------------------------------------

/** Full-freeze duration (seconds of REAL time) when the boss's slam lands. */
const FREEZE_BOSS_SLAM_LAND = 0.09;

/** Full-freeze duration when the boss is defeated (runs BEFORE its slow-mo). */
const FREEZE_BOSS_DEFEATED = 0.12;

/** Full-freeze duration for a "big connect" — several skill hits in one frame. */
const FREEZE_SKILL_BURST = 0.06;

/** Minimum simultaneous `hit` events with `source: "skill"` to count as a burst. */
const SKILL_BURST_MIN_HITS = 3;

/**
 * M7.9 "Grand Expansion" — the swordsman's tier-3 skill-4 (SKYFALL BLADE,
 * `sword_skyfall`) gets a real TIME-FREEZE beat: the biggest hit-stop in the
 * game, bigger than `bossDefeated`'s own freeze, selling "the whole field
 * freezes as the sky-blade lands" (render/audio/UI keep running on real time
 * through this, per the class doc's freeze contract — only the sim
 * accumulator is starved). `render/fx/FxController.ts`'s own beat for this
 * skill (shake/rings/lightning bolts) is untouched by this value; this only
 * shapes how much sim time this frame hands to `drainAccumulator()`.
 */
const FREEZE_SWORD_SKYFALL = 0.16;

/** Boss-defeated slow-mo: time-scale, hold duration, then ease-back duration. */
const SLOWMO_BOSS_DEFEATED_SCALE = 0.25;
const SLOWMO_BOSS_DEFEATED_HOLD_S = 0.6;
const SLOWMO_BOSS_DEFEATED_EASE_S = 0.3;

/** Boss-enraged slow-mo: time-scale, hold duration, then ease-back duration. */
const SLOWMO_BOSS_ENRAGED_SCALE = 0.5;
const SLOWMO_BOSS_ENRAGED_HOLD_S = 0.3;
const SLOWMO_BOSS_ENRAGED_EASE_S = 0.2;

/** A slow-mo effect's shape: a flat `scale` held for `hold` seconds, then an
 * ease back to 1x over `ease` seconds. */
interface SlowmoSpec {
  scale: number;
  hold: number;
  ease: number;
}

/** Live slow-mo countdown state (mutated as real time is consumed). */
interface SlowmoState {
  scale: number;
  holdRemaining: number;
  easeRemaining: number;
  easeDuration: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A slow-mo's "strength" for overlap comparisons: how slow (`scale`) and how
 * much total time (`remaining`) it still has to run. */
interface SlowmoStrength {
  scale: number;
  remaining: number;
}

function specStrength(spec: SlowmoSpec): SlowmoStrength {
  return { scale: spec.scale, remaining: spec.hold + spec.ease };
}

function stateStrength(state: SlowmoState): SlowmoStrength {
  return {
    scale: state.scale,
    remaining: state.holdRemaining + state.easeRemaining,
  };
}

/** "Stronger" = lower scale (more slowed down), or — at an equal scale — more
 * total remaining time. Mirrors the freeze comparison (longer remaining wins). */
function isStronger(candidate: SlowmoStrength, current: SlowmoStrength | null): boolean {
  if (!current) return true;
  if (candidate.scale < current.scale) return true;
  if (candidate.scale > current.scale) return false;
  return candidate.remaining > current.remaining;
}

export class TimeDirector {
  /** Seconds of REAL time still to be frozen (sim gets 0 elapsed while this drains). */
  private freezeRemaining = 0;

  /** Active slow-mo countdown, or `null` when at normal (1x) speed. */
  private slowmo: SlowmoState | null = null;

  /**
   * Shapes this frame's real elapsed seconds into the elapsed seconds that
   * should be fed to `drainAccumulator()`. `events` is the PREVIOUS frame's
   * `GameEvent` batch (see the class doc's latency note).
   */
  shape(elapsedSeconds: number, events: readonly GameEvent[]): number {
    this.applyTriggers(events);

    let remaining = elapsedSeconds;

    if (this.freezeRemaining > 0) {
      const consumed = Math.min(this.freezeRemaining, remaining);
      this.freezeRemaining -= consumed;
      remaining -= consumed;
    }

    if (remaining <= 0) return 0;
    if (!this.slowmo) return remaining;
    return this.advanceSlowmo(remaining);
  }

  /** Scans this frame's events for triggers and, per the overlap policy,
   * replaces the current freeze/slow-mo only if the new one is stronger. */
  private applyTriggers(events: readonly GameEvent[]): void {
    let freezeCandidate = 0;
    let bestSpec: SlowmoSpec | null = null;
    let bestStrength: SlowmoStrength | null = null;
    let skillHitsThisFrame = 0;

    for (const e of events) {
      switch (e.type) {
        case "bossSlamLand":
          freezeCandidate = Math.max(freezeCandidate, FREEZE_BOSS_SLAM_LAND);
          break;
        case "bossDefeated": {
          freezeCandidate = Math.max(freezeCandidate, FREEZE_BOSS_DEFEATED);
          const spec: SlowmoSpec = {
            scale: SLOWMO_BOSS_DEFEATED_SCALE,
            hold: SLOWMO_BOSS_DEFEATED_HOLD_S,
            ease: SLOWMO_BOSS_DEFEATED_EASE_S,
          };
          const strength = specStrength(spec);
          if (isStronger(strength, bestStrength)) {
            bestSpec = spec;
            bestStrength = strength;
          }
          break;
        }
        case "bossEnraged": {
          const spec: SlowmoSpec = {
            scale: SLOWMO_BOSS_ENRAGED_SCALE,
            hold: SLOWMO_BOSS_ENRAGED_HOLD_S,
            ease: SLOWMO_BOSS_ENRAGED_EASE_S,
          };
          const strength = specStrength(spec);
          if (isStronger(strength, bestStrength)) {
            bestSpec = spec;
            bestStrength = strength;
          }
          break;
        }
        case "skillCast":
          if (e.skillId === "sword_skyfall") {
            freezeCandidate = Math.max(freezeCandidate, FREEZE_SWORD_SKYFALL);
          }
          break;
        case "hit":
          if (e.source === "skill") skillHitsThisFrame++;
          break;
        default:
          break;
      }
    }

    if (skillHitsThisFrame >= SKILL_BURST_MIN_HITS) {
      freezeCandidate = Math.max(freezeCandidate, FREEZE_SKILL_BURST);
    }

    if (freezeCandidate > this.freezeRemaining) {
      this.freezeRemaining = freezeCandidate;
    }

    if (
      bestSpec &&
      bestStrength &&
      isStronger(bestStrength, this.slowmo ? stateStrength(this.slowmo) : null)
    ) {
      this.slowmo = {
        scale: bestSpec.scale,
        holdRemaining: bestSpec.hold,
        easeRemaining: bestSpec.ease,
        easeDuration: bestSpec.ease,
      };
    }
  }

  /** Consumes `remaining` real seconds against the active slow-mo (hold phase
   * at a flat scale, then a linear ease back to 1x), returning shaped seconds.
   * Loops phase-to-phase in case a single frame's `remaining` outlasts one
   * phase (bounded by `MAX_FRAME_SECONDS` in GameClient, so this is at most a
   * couple of iterations). */
  private advanceSlowmo(remaining: number): number {
    let output = 0;

    while (remaining > 0 && this.slowmo) {
      const sm = this.slowmo;

      if (sm.holdRemaining > 0) {
        const dt = Math.min(sm.holdRemaining, remaining);
        output += dt * sm.scale;
        sm.holdRemaining -= dt;
        remaining -= dt;
        continue;
      }

      if (sm.easeRemaining > 0) {
        const dt = Math.min(sm.easeRemaining, remaining);
        const startFrac = 1 - sm.easeRemaining / sm.easeDuration;
        const endFrac = 1 - (sm.easeRemaining - dt) / sm.easeDuration;
        const avgScale =
          (lerp(sm.scale, 1, startFrac) + lerp(sm.scale, 1, endFrac)) / 2;
        output += dt * avgScale;
        sm.easeRemaining -= dt;
        remaining -= dt;
        continue;
      }

      // Both phases drained: slow-mo is over, hand back the rest at 1x.
      this.slowmo = null;
    }

    return output + remaining;
  }
}
