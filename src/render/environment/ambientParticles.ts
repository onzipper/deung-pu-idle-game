/**
 * Ambient life: biome-flavored drifting particles (light motes, falling
 * leaves, dust, rising embers, snow). Unlike `fx/particles.ts`'s burst pool
 * (finite life, event-triggered), these are perpetual and wrap forever —
 * there is no "death", just position wrap, so a fixed small pool of
 * pre-created `Graphics` dots never allocates again after construction.
 * Density is capped low by design (see `biomes.ts` — never meant to
 * distract from combat).
 */

import { Container, Graphics } from "pixi.js";
import type { AmbientKind } from "@/render/environment/biomes";
import { safeRadius } from "@/render/theme";

interface AmbientSlot {
  g: Graphics;
  x: number;
  y: number;
  phase: number;
  size: number;
  alphaBase: number;
}

interface KindProfile {
  /** Leftward base drift (world-travel feel), world-px/second. */
  driftX: number;
  /** Vertical base drift: positive falls, negative rises, 0 = float in place. */
  driftY: number;
  swayAmp: number;
  swayFreq: number;
  /** Whether alpha pulses (fireflies/embers) or stays constant (leaf/snow/dust). */
  flicker: boolean;
  sizeMin: number;
  sizeMax: number;
  alphaMin: number;
  alphaMax: number;
}

const PROFILES: Record<AmbientKind, KindProfile> = {
  mote: {
    driftX: 3,
    driftY: 0,
    swayAmp: 10,
    swayFreq: 0.6,
    flicker: true,
    sizeMin: 1.2,
    sizeMax: 2.2,
    alphaMin: 0.25,
    alphaMax: 0.85,
  },
  leaf: {
    driftX: 8,
    driftY: 14,
    swayAmp: 16,
    swayFreq: 0.9,
    flicker: false,
    sizeMin: 2,
    sizeMax: 3.5,
    alphaMin: 0.5,
    alphaMax: 0.8,
  },
  dust: {
    driftX: 5,
    driftY: 0,
    swayAmp: 5,
    swayFreq: 0.4,
    flicker: false,
    sizeMin: 1,
    sizeMax: 2,
    alphaMin: 0.12,
    alphaMax: 0.3,
  },
  ember: {
    driftX: 4,
    driftY: -18,
    swayAmp: 12,
    swayFreq: 1.1,
    flicker: true,
    sizeMin: 1.4,
    sizeMax: 2.6,
    alphaMin: 0.4,
    alphaMax: 0.95,
  },
  snow: {
    driftX: 6,
    driftY: 10,
    swayAmp: 14,
    swayFreq: 0.7,
    flicker: false,
    sizeMin: 1.5,
    sizeMax: 3,
    alphaMin: 0.5,
    alphaMax: 0.9,
  },
};

export class AmbientField {
  readonly view = new Container();
  private readonly slots: AmbientSlot[];
  private readonly profile: KindProfile;
  private t = 0;

  constructor(
    kind: AmbientKind,
    color: number,
    count: number,
    private readonly worldWidth: number,
    private readonly topY: number,
    private readonly bottomY: number,
  ) {
    this.profile = PROFILES[kind];
    this.slots = Array.from({ length: Math.max(1, count) }, () => {
      const g = new Graphics();
      const size = this.profile.sizeMin + Math.random() * (this.profile.sizeMax - this.profile.sizeMin);
      const alphaBase =
        this.profile.alphaMin + Math.random() * (this.profile.alphaMax - this.profile.alphaMin);
      g.circle(0, 0, safeRadius(size)).fill({ color, alpha: 1 });
      const x = Math.random() * worldWidth;
      const y = topY + Math.random() * Math.max(1, bottomY - topY);
      g.position.set(x, y);
      g.alpha = alphaBase;
      this.view.addChild(g);
      return { g, x, y, phase: Math.random() * Math.PI * 2, size, alphaBase };
    });
  }

  /** Advance every particle by `dt` real seconds (never sub-step count). */
  update(dt: number): void {
    this.t += dt;
    const p = this.profile;
    const margin = 20;
    const spanY = Math.max(1, this.bottomY - this.topY);
    for (const slot of this.slots) {
      slot.x -= p.driftX * dt;
      slot.y += p.driftY * dt;

      if (slot.x < -margin) slot.x += this.worldWidth + margin * 2;
      if (slot.x > this.worldWidth + margin) slot.x -= this.worldWidth + margin * 2;
      if (slot.y > this.bottomY) slot.y -= spanY;
      if (slot.y < this.topY) slot.y += spanY;

      const sway = Math.sin(this.t * p.swayFreq + slot.phase) * p.swayAmp;
      slot.g.position.set(slot.x + sway, slot.y);

      if (p.flicker) {
        const flicker = 0.5 + 0.5 * Math.sin(this.t * 2.2 + slot.phase * 1.7);
        slot.g.alpha = slot.alphaBase * (0.4 + 0.6 * flicker);
      }
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
