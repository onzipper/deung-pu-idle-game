/**
 * Soul-wisp pool — a small glowing mote that rises and fades, the "spirit
 * leaving the body" beat for enemy AND hero deaths (DEATH & SPAWN DRAMA,
 * 86d3k2qjk items 1 + 3). One shared pool, two call patterns:
 *
 *  - `trySpawn()` — enemy kills (frequent, many/sec at 3x speed): SKIPS
 *    outright if every slot is already busy, rather than evicting an
 *    in-flight wisp or queuing — per spec, "wisps can skip when the pool is
 *    saturated" so a kill-spam doesn't turn into flicker/pop-in.
 *  - `spawn()` — hero deaths (rare, at most 3 heroes at once): always plays,
 *    evicting the oldest ring-buffer slot in the (very unlikely) case every
 *    slot is busy.
 *
 * Built once per spawn (two layered flat-alpha circles — soft outer glow +
 * bright core, no gradients); every frame after that only touches
 * position/alpha, never re-walks the path.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const DEFAULT_CAP = 10;
/** Gentle side-to-side wobble while rising — reads as "drifting up", not a
 * particle fired in a straight line. */
const WOBBLE_FREQ = 3.2;

interface WispSlot {
  g: Graphics;
  active: boolean;
  age: number;
  life: number;
  y: number;
  baseX: number;
  riseSpeed: number;
  wobbleAmp: number;
  wobblePhase: number;
  startAlpha: number;
}

export interface SpawnWispOptions {
  x: number;
  y: number;
  color: number;
  /** Total px risen over the wisp's life (spec: enemy ~40px). */
  rise?: number;
  life?: number;
  radius?: number;
}

export class SoulWispPool {
  private readonly slots: WispSlot[];
  private cursor = 0;

  constructor(
    private readonly container: Container,
    cap: number = DEFAULT_CAP,
  ) {
    this.slots = Array.from({ length: cap }, () => {
      const g = new Graphics();
      g.visible = false;
      container.addChild(g);
      return {
        g,
        active: false,
        age: 0,
        life: 0.9,
        y: 0,
        baseX: 0,
        riseSpeed: 40,
        wobbleAmp: 3,
        wobblePhase: 0,
        startAlpha: 0.9,
      };
    });
  }

  private findFree(): WispSlot | null {
    for (const s of this.slots) if (!s.active) return s;
    return null;
  }

  private claimOldest(): WispSlot {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    return slot;
  }

  private activate(slot: WispSlot, opts: SpawnWispOptions): void {
    const life = Math.max(0.1, opts.life ?? 0.9);
    const rise = opts.rise ?? 40;
    const r = safeRadius(opts.radius ?? 3);

    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.baseX = opts.x;
    slot.y = opts.y;
    slot.riseSpeed = rise / life;
    slot.wobbleAmp = r * 1.2;
    slot.wobblePhase = Math.random() * Math.PI * 2;
    slot.startAlpha = 0.9;

    slot.g.visible = true;
    slot.g.alpha = slot.startAlpha;
    slot.g.position.set(slot.baseX, slot.y);
    slot.g.clear();
    slot.g.circle(0, 0, safeRadius(r * 2.2)).fill({ color: opts.color, alpha: 0.28 });
    slot.g.circle(0, 0, r).fill({ color: opts.color, alpha: 0.95 });
  }

  /** Enemy-kill wisps: skip entirely if the pool is saturated (see module doc). */
  trySpawn(opts: SpawnWispOptions): void {
    const slot = this.findFree();
    if (!slot) return;
    this.activate(slot, opts);
  }

  /** Hero-death wisps: always plays. */
  spawn(opts: SpawnWispOptions): void {
    this.activate(this.findFree() ?? this.claimOldest(), opts);
  }

  /** Advance every live wisp by `dt` real seconds. */
  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        slot.g.visible = false;
        slot.g.clear();
        continue;
      }
      const frac = slot.age / slot.life;
      slot.y -= slot.riseSpeed * dt;
      slot.wobblePhase += dt * WOBBLE_FREQ;
      const wobbleX = slot.baseX + Math.sin(slot.wobblePhase) * slot.wobbleAmp;
      slot.g.position.set(wobbleX, slot.y);
      slot.g.alpha = slot.startAlpha * (1 - frac);
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      this.container.removeChild(slot.g);
      slot.g.destroy();
    }
    this.slots.length = 0;
  }
}
