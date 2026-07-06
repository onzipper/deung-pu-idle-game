/**
 * Fast-travel portal fx (M7.5 "Fast travel" — a portal materializes for the
 * player to walk into, per the owner's gate-is-the-medium feel spec) —
 * `FxController`'s dedicated controller for the `fastTravelCastStart` ->
 * `fastTravelArrive`/`fastTravelBlocked` lifecycle (`engine/state/events.ts`).
 *
 * A small fixed-slot state machine (like `gearAura.ts`/`castAura.ts`), NOT a
 * fire-and-forget ring-buffer pool — there is exactly one channel possible at
 * a time today (solo play, single `state.fastTravelCast`), but a couple of
 * slots are kept as a defensive cap rather than hard-coding "exactly one".
 *
 * Footgun 10 (CLAUDE.md): every shape here is drawn SOLID on the default
 * (normal) blend mode plus a darker outline pass — never `blendMode: "add"`
 * (additive white-out over bright daytime scenes). Every Graphics is built
 * ONCE per channel-start (`buildSwirl()`); per-frame work only mutates
 * rotation/scale/alpha (build-once/transform-only, same convention as
 * `gearAura.ts`).
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const MAX_SLOTS = 2; // defensive cap — solo play only ever channels one at a time
const RING_COUNT = 2;
const PETAL_COUNT = 5;
const PETAL_LEN = 7;
const PETAL_WIDTH = 3;
const OUTER_RADIUS = 16;
const CORE_MAX_RADIUS = 6;
/** Fraction of the channel spent easing the whole swirl in from nothing. */
const FADE_IN_FRAC = 0.18;
const PETAL_ORBIT_SPEED_BASE = 1.6; // rad/s at channel start
const PETAL_ORBIT_SPEED_PEAK = 6.5; // rad/s as the channel completes ("winding up")
const RING_ROT_SPEED = 1.1;

const COLLAPSE_DURATION = 0.18; // clean "stepped through" collapse on arrival
const FIZZLE_DURATION = 0.24; // quick scatter-and-fade on a mid-channel cancel

type SlotMode = "idle" | "channel" | "collapse" | "fizzle";

interface Slot {
  root: Container;
  rings: Graphics[];
  petals: Graphics[];
  core: Graphics;
  mode: SlotMode;
  t: number; // elapsed real seconds in the current mode
  duration: number; // channel duration (mode === "channel" only)
  ringPhase: number;
  petalPhase: number;
  /** Per-petal random fizzle-scatter direction, assigned once on `cancel()`. */
  fizzleAngles: number[];
}

function buildPetalShape(g: Graphics): void {
  const pts = [0, -PETAL_LEN, PETAL_WIDTH * 0.5, 0, 0, PETAL_LEN * 0.35, -PETAL_WIDTH * 0.5, 0];
  g.clear();
  g.poly(pts, true).fill(PALETTE.travelPortal);
  g.poly(pts, true).stroke({ width: 1, color: PALETTE.travelPortalDark, alpha: 0.85 });
}

export class TravelPortalController {
  private readonly slots: Slot[] = [];

  constructor(private readonly container: Container) {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const root = new Container();
      root.visible = false;
      container.addChild(root);

      const rings: Graphics[] = [];
      for (let i = 0; i < RING_COUNT; i++) {
        const g = new Graphics();
        root.addChild(g);
        rings.push(g);
      }
      const petals: Graphics[] = [];
      for (let i = 0; i < PETAL_COUNT; i++) {
        const g = new Graphics();
        buildPetalShape(g);
        root.addChild(g);
        petals.push(g);
      }
      const core = new Graphics();
      root.addChild(core);

      this.slots.push({
        root,
        rings,
        petals,
        core,
        mode: "idle",
        t: 0,
        duration: 1,
        ringPhase: 0,
        petalPhase: 0,
        fizzleAngles: petals.map((_, i) => (Math.PI * 2 * i) / PETAL_COUNT),
      });
    }
  }

  /** `fastTravelCastStart`: materialize the swirl beside the hero and begin
   * winding up over `duration` (real seconds — the engine's
   * `CONFIG.travel.fastTravelCastSeconds`). Falls back to slot 0 if every
   * slot is already busy (should never happen in solo play — `MAX_SLOTS` is
   * a defensive cap, not a real concurrency expectation). */
  startChannel(x: number, y: number, duration: number): void {
    const slot = this.slots.find((s) => s.mode === "idle") ?? this.slots[0];
    slot.mode = "channel";
    slot.t = 0;
    slot.duration = Math.max(0.1, duration);
    slot.ringPhase = 0;
    slot.petalPhase = 0;
    slot.root.visible = true;
    slot.root.alpha = 0;
    slot.root.position.set(x, y);
  }

  /** `fastTravelArrive`: the channel completed — collapse cleanly at the
   * ORIGIN (the arrival pop itself is a separate one-shot ring/burst at the
   * destination gate, driven from `FxController` via the shared pools). */
  completeChannel(): void {
    for (const s of this.slots) {
      if (s.mode === "channel") {
        s.mode = "collapse";
        s.t = 0;
      }
    }
  }

  /** `fastTravelBlocked` mid-channel (damaged/dead/etc.): a quick fizzle
   * instead of a clean collapse. No-op if nothing was channeling (a blocked
   * intent that never actually started one, e.g. tapping a locked zone). */
  cancelChannel(): void {
    for (const s of this.slots) {
      if (s.mode === "channel") {
        s.mode = "fizzle";
        s.t = 0;
      }
    }
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.mode === "idle") continue;
      s.t += dt;

      if (s.mode === "channel") {
        this.updateChannel(s, dt);
      } else if (s.mode === "collapse") {
        this.updateCollapse(s);
      } else {
        this.updateFizzle(s);
      }
    }
  }

  private updateChannel(s: Slot, dt: number): void {
    const progress = Math.min(1, s.t / s.duration);
    const fadeIn = Math.min(1, s.t / (s.duration * FADE_IN_FRAC));
    s.root.alpha = fadeIn;

    s.ringPhase += RING_ROT_SPEED * (0.6 + progress) * dt;
    s.petalPhase +=
      (PETAL_ORBIT_SPEED_BASE + (PETAL_ORBIT_SPEED_PEAK - PETAL_ORBIT_SPEED_BASE) * progress) * dt;

    s.rings.forEach((g, i) => {
      const r = OUTER_RADIUS - i * 4 + Math.sin(s.t * 3 + i) * 1.2;
      g.clear();
      g.circle(0, 0, safeRadius(r)).stroke({
        width: 2,
        color: PALETTE.travelPortal,
        alpha: 0.7 - i * 0.15,
      });
      g.rotation = s.ringPhase * (i % 2 === 0 ? 1 : -1);
    });

    const petalRadius = OUTER_RADIUS * (1 - 0.35 * progress); // draws inward as it winds up
    s.petals.forEach((g, i) => {
      const a = s.petalPhase + (Math.PI * 2 * i) / PETAL_COUNT;
      g.position.set(Math.cos(a) * petalRadius, Math.sin(a) * petalRadius);
      g.rotation = a + Math.PI / 2;
      g.alpha = 0.85;
    });

    const coreR = CORE_MAX_RADIUS * progress;
    s.core.clear();
    if (coreR > 0.05) {
      s.core.circle(0, 0, safeRadius(coreR)).fill({ color: PALETTE.travelPortalCore, alpha: 0.8 });
    }
  }

  private updateCollapse(s: Slot): void {
    const frac = Math.min(1, s.t / COLLAPSE_DURATION);
    const scale = Math.max(0.0001, 1 - frac);
    s.root.scale.set(scale);
    s.root.alpha = 1 - frac;
    if (frac >= 1) this.retire(s);
  }

  private updateFizzle(s: Slot): void {
    const frac = Math.min(1, s.t / FIZZLE_DURATION);
    s.petals.forEach((g, i) => {
      const a = s.fizzleAngles[i];
      const r = OUTER_RADIUS * (1 + frac * 1.8);
      g.position.set(Math.cos(a) * r, Math.sin(a) * r);
      g.alpha = 0.85 * (1 - frac);
    });
    s.rings.forEach((g) => {
      g.alpha = 1 - frac;
    });
    s.core.alpha = 1 - frac;
    s.root.alpha = 1 - frac * 0.3;
    if (frac >= 1) this.retire(s);
  }

  private retire(s: Slot): void {
    s.mode = "idle";
    s.root.visible = false;
    s.root.scale.set(1);
    s.root.alpha = 1;
    for (const g of s.petals) g.alpha = 1;
    for (const g of s.rings) g.alpha = 1;
    s.core.alpha = 1;
  }

  destroy(): void {
    for (const s of this.slots) {
      this.container.removeChild(s.root);
      s.root.destroy({ children: true });
    }
    this.slots.length = 0;
  }
}
