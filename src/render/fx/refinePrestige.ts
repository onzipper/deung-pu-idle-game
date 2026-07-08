/**
 * M7.6+ refine-prestige ladder — the "+9"/"+10" steps of the owner's 3-step
 * high-refine escalation (the "+8" step is handled in-place by
 * `gearSparkle.ts`'s own `boosted` flag; see that module's doc comment).
 *
 * ARMOR-ONLY since the M9 pixel-fx weapon port: `FxController.updateGearFx()`
 * now calls this module with ONLY the `${slot}-armor` key — the WEAPON side
 * (which used to ride `gearAura.ts`'s anchor, now deleted) was retired in
 * favor of `refineFxRecipes.ts`'s own +8/+9/+10 recipe steps
 * (crackle/molten/beat), which cover the whole weapon ladder on their own.
 * The class itself stays generic (any caller-chosen key still works — see
 * the tests), only its ONE live call site narrowed. Per anchor:
 *
 *  - **+9**: an intermittent accent crackle — a small spark burst at the
 *    anchor every `CRACKLE_INTERVAL`-ish real seconds ("almost there").
 *  - **+10**: the flex tier — a CONTINUOUS signature beat: a slow trickle of
 *    rising embers (reads as a lazy ember column, not a burst), a slow
 *    orbiting halo pulse (a big soft ring at a slower cadence than the
 *    crackle), and an occasional ground shimmer at the hero's feet. Uses the
 *    `refinePrestige*` palette family (theme.ts) — a brighter/whiter variant
 *    of the plain `auraFlame*` tones so a +10 refined piece reads as "hotter/
 *    rarer", never confusable with a naturally-rolled tier-6/epic's aura.
 *
 * Deliberately reuses the ALREADY-POOLED, ALREADY-SHARED `ParticlePool`/
 * `RingPool` instances `FxController` owns (constructed once, shared across
 * every fx effect in the game) — this module adds ZERO new Pixi display
 * objects of its own. A few extra low-rate spawns into pools that are
 * already budgeted for combat juice, per the "reuse pooling caps, don't add
 * new uncapped emitters" mobile-GPU constraint. Timers are keyed by a small
 * caller-chosen string (e.g. `${heroSlot}-weapon` / `${heroSlot}-armor`) —
 * bounded to at most `MAX_SLOTS * 2` live keys in practice (party cap × two
 * gear slots), so the backing `Map` never grows unbounded.
 */

import { burst, type ParticlePool } from "@/render/fx/particles";
import type { RingPool } from "@/render/fx/rings";
import { GROUND_Y } from "@/render/layout";
import { PALETTE } from "@/render/theme";

/** Ground shimmer lands at the hero's feet, not the weapon/armor anchor's own
 * (chest/arm) height — mirrors the `GROUND_Y - 6` convention every other
 * "effectively 1D on x" ground beat in `FxController.ts` already uses
 * (`ITEM_DROP_POP_Y`/`TARGET_LOCK_Y`). */
const SHIMMER_Y = GROUND_Y - 6;

// ---- +9: intermittent weapon/armor crackle ---------------------------------
const CRACKLE_INTERVAL = 1.6; // real seconds between crackle beats
const CRACKLE_JITTER = 0.6;
const CRACKLE_PARTICLE_COUNT = 4;
const CRACKLE_PARTICLE_SPEED = 55;
const CRACKLE_PARTICLE_LIFE = 0.3;
const CRACKLE_PARTICLE_RADIUS = 1.8;

// ---- +10: continuous "lazy ember column" trickle ---------------------------
const EMBER_SPAWN_INTERVAL = 0.16; // one ember roughly every ~0.16s
const EMBER_RISE_SPEED = 30;
const EMBER_LIFE = 0.85;
const EMBER_RADIUS = 1.6;
const EMBER_DRAG = 0.45; // embers slow near the top of their rise, not accelerate

// ---- +10: slow orbiting halo pulse (a big, soft, slow-cadence ring) --------
const HALO_INTERVAL = 1.9;
const HALO_R0 = 10;
const HALO_R1 = 32;
const HALO_DURATION = 1.4;
const HALO_WIDTH = 2;

// ---- +10: occasional ground shimmer ----------------------------------------
const SHIMMER_INTERVAL = 2.6;
const SHIMMER_JITTER = 0.9;
const SHIMMER_PARTICLE_COUNT = 5;
const SHIMMER_PARTICLE_SPEED = 24;
const SHIMMER_PARTICLE_LIFE = 0.5;
const SHIMMER_PARTICLE_RADIUS = 1.4;
const SHIMMER_GRAVITY = 40; // gentle settle back to the ground

/** Refine level thresholds this module reacts to (the "+8" boost lives in
 * `gearAura.ts`/`gearSparkle.ts` instead — see module doc). */
export const REFINE_CRACKLE_THRESHOLD = 9;
export const REFINE_SIGNATURE_THRESHOLD = 10;

interface KeyTimers {
  crackle: number;
  ember: number;
  halo: number;
  shimmer: number;
}

export class RefinePrestigeFx {
  private readonly timers = new Map<string, KeyTimers>();

  constructor(
    private readonly particles: ParticlePool,
    private readonly rings: RingPool,
  ) {}

  private timersFor(key: string): KeyTimers {
    let t = this.timers.get(key);
    if (!t) {
      // Randomized initial phase so several concurrently-prestiged
      // weapon/armor slots don't all crackle/pulse in lockstep.
      t = {
        crackle: Math.random() * CRACKLE_INTERVAL,
        ember: Math.random() * EMBER_SPAWN_INTERVAL,
        halo: Math.random() * HALO_INTERVAL,
        shimmer: Math.random() * SHIMMER_INTERVAL,
      };
      this.timers.set(key, t);
    }
    return t;
  }

  /** Called once per (hero slot × gear slot) per frame by `FxController`,
   * same convention as `GearAuraController.setSlot`/`GearSparklePool.setSlot`
   * — `refineLevel` is that ONE piece's own refine level (0 when its aura/
   * sparkle isn't currently active at all, so the timers just idle). `x`/`y`
   * is the same weapon/armor anchor `updateGearFx()` already resolved. */
  update(dt: number, key: string, refineLevel: number, x: number, y: number): void {
    const t = this.timersFor(key);

    if (refineLevel >= REFINE_CRACKLE_THRESHOLD) {
      t.crackle -= dt;
      if (t.crackle <= 0) {
        t.crackle = CRACKLE_INTERVAL + Math.random() * CRACKLE_JITTER;
        burst(this.particles, x, y, CRACKLE_PARTICLE_COUNT, PALETTE.refinePrestigeCore, {
          speed: CRACKLE_PARTICLE_SPEED,
          life: CRACKLE_PARTICLE_LIFE,
          radius: CRACKLE_PARTICLE_RADIUS,
        });
      }
    } else {
      t.crackle = CRACKLE_INTERVAL;
    }

    if (refineLevel >= REFINE_SIGNATURE_THRESHOLD) {
      t.ember -= dt;
      if (t.ember <= 0) {
        t.ember = EMBER_SPAWN_INTERVAL;
        this.particles.spawn({
          x: x + (Math.random() - 0.5) * 6,
          y,
          vx: (Math.random() - 0.5) * 8,
          vy: -EMBER_RISE_SPEED * (0.75 + Math.random() * 0.5),
          life: EMBER_LIFE,
          radius: EMBER_RADIUS,
          color: PALETTE.refinePrestige,
          drag: EMBER_DRAG,
        });
      }

      t.halo -= dt;
      if (t.halo <= 0) {
        t.halo = HALO_INTERVAL;
        this.rings.spawn({
          x,
          y,
          r0: HALO_R0,
          r1: HALO_R1,
          duration: HALO_DURATION,
          width: HALO_WIDTH,
          color: PALETTE.refinePrestigeCore,
        });
      }

      t.shimmer -= dt;
      if (t.shimmer <= 0) {
        t.shimmer = SHIMMER_INTERVAL + Math.random() * SHIMMER_JITTER;
        burst(this.particles, x, SHIMMER_Y, SHIMMER_PARTICLE_COUNT, PALETTE.refinePrestige, {
          speed: SHIMMER_PARTICLE_SPEED,
          life: SHIMMER_PARTICLE_LIFE,
          radius: SHIMMER_PARTICLE_RADIUS,
          gravity: SHIMMER_GRAVITY,
        });
      }
    } else {
      t.ember = EMBER_SPAWN_INTERVAL;
      t.halo = HALO_INTERVAL;
      t.shimmer = SHIMMER_INTERVAL;
    }
  }
}
