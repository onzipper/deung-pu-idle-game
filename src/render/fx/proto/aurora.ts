/**
 * PROTO ONLY (`/proto-shaders`) — tundra aurora ribbon, effect #2. Layered
 * sine-wave `Graphics` polys (same "sample points along a wave, build a poly"
 * vocabulary `silhouettes.ts`'s `rolling-hills` and `ambientParticles.ts`
 * already use elsewhere — read-only pattern reuse, not a shared import) tinted
 * cold cyan/green at low alpha, plus an optional soft blur for glow. NOT a
 * `DisplacementFilter` — the brief allows "custom shader OR layered
 * displacement+color"; this is the layered-color route, kept filter-cheap.
 *
 * `lerpColor` is imported read-only from the real `environment/colorUtils.ts`
 * (pure color math, no Pixi/canvas calls) — nothing in `environment/` is
 * modified.
 */

import { Graphics, Container } from "pixi.js";
import { lerpColor } from "@/render/environment/colorUtils";
import { safeRadius } from "@/render/theme";

interface Band {
  g: Graphics;
  yBase: number;
  amp1: number;
  amp2: number;
  freq1: number;
  freq2: number;
  phase: number;
  speed: number;
  thickness: number;
  colorA: number;
  colorB: number;
  baseAlpha: number;
}

const CYAN = 0x7fe6d8;
const GREEN = 0x7ad98a;

export class AuroraEffect {
  readonly view = new Container();
  private readonly bands: Band[];
  private t = 0;
  private strength = 0.6;

  constructor(private readonly width: number, skyTop: number, skyMid: number) {
    this.bands = [
      {
        yBase: skyTop + (skyMid - skyTop) * 0.35,
        amp1: 14,
        amp2: 7,
        freq1: 0.012,
        freq2: 0.027,
        phase: 0,
        speed: 0.35,
        thickness: 22,
        colorA: CYAN,
        colorB: GREEN,
        baseAlpha: 0.16,
      },
      {
        yBase: skyTop + (skyMid - skyTop) * 0.55,
        amp1: 10,
        amp2: 9,
        freq1: 0.018,
        freq2: 0.009,
        phase: 2.1,
        speed: 0.5,
        thickness: 16,
        colorA: GREEN,
        colorB: CYAN,
        baseAlpha: 0.12,
      },
    ].map((cfg) => {
      const g = new Graphics();
      this.view.addChild(g);
      return { ...cfg, g };
    });
  }

  setStrength(strength01: number): void {
    this.strength = Math.max(0, Math.min(1, strength01));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.strength <= 0) {
      for (const b of this.bands) b.g.visible = false;
      return;
    }
    for (const b of this.bands) {
      b.g.visible = true;
      b.g.clear();
      const step = 24;
      const topPts: { x: number; y: number }[] = [];
      const botPts: { x: number; y: number }[] = [];
      for (let x = -60; x <= this.width + 60; x += step) {
        const wave =
          Math.sin(x * b.freq1 + this.t * b.speed + b.phase) * b.amp1 +
          Math.sin(x * b.freq2 - this.t * b.speed * 0.6 + b.phase) * b.amp2;
        const y = b.yBase + wave;
        topPts.push({ x, y: y - b.thickness / 2 });
        botPts.push({ x, y: y + b.thickness / 2 });
      }
      const poly = [...topPts, ...botPts.reverse()].flatMap((p) => [p.x, p.y]);
      const tone = lerpColor(b.colorA, b.colorB, (Math.sin(this.t * 0.2 + b.phase) + 1) / 2);
      b.g.poly(poly).fill({ color: tone, alpha: safeRadius(b.baseAlpha * this.strength) });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
