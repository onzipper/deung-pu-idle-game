/**
 * Pooled crescent-arc effects for the swordsman (HERO SIGNATURE PASS,
 * 86d3k2q8f): a quick static "slash flash" along the current combo swing's
 * path (item 2), and small rotating "shard" chips flung outward by the
 * spin-skill's crescent nova (item 6). Both modes share one fixed-size
 * ring-buffer pool — same eviction pattern as `rings.ts`/`particles.ts`.
 *
 * A crescent is drawn as a sampled annulus-segment polygon (outer arc walked
 * forward, inner arc walked backward, closed into one poly) — deliberately
 * NOT `Graphics.arc().fill()`, which collapses toward the path's stale pen
 * position instead of the arc's own coordinates (see `heroView.ts`'s
 * `arcFanPoints()` doc comment for the exact footgun this avoids). The poly
 * is built ONCE per spawn; only position/rotation/alpha change per frame
 * afterward (build-once, transform-only, same convention as the rig).
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

/** Total concurrent crescents (slashes + shards) sharing this pool — spec
 * knob: "crescents ~8". */
const DEFAULT_CAP = 8;
/** Sampled points per arc edge — cheap, plenty smooth at this on-screen size. */
const ARC_SEGMENTS = 6;

type Mode = "slash" | "shard";

interface CrescentSlot {
  g: Graphics;
  active: boolean;
  mode: Mode;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotationSpeed: number;
  startAlpha: number;
}

export interface SpawnSlashOptions {
  x: number;
  y: number;
  /** Local sweep-center angle (radians) — which way the slash reads as moving. */
  angle: number;
  /** Total arc width swept (radians). */
  sweep?: number;
  radius?: number;
  thickness?: number;
  life?: number;
  color: number;
  alpha?: number;
}

export interface SpawnShardOptions {
  x: number;
  y: number;
  /** Launch direction (radians). */
  angle: number;
  speed?: number;
  rotationSpeed?: number;
  radius?: number;
  thickness?: number;
  life?: number;
  color: number;
}

export class CrescentPool {
  private readonly slots: CrescentSlot[];
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
        mode: "slash" as Mode,
        age: 0,
        life: 0.15,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rotationSpeed: 0,
        startAlpha: 1,
      };
    });
  }

  private claim(): CrescentSlot {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    return slot;
  }

  /** A quick, stationary arc flash along a basic-attack swing's path (item 2). */
  spawnSlash(opts: SpawnSlashOptions): void {
    const slot = this.claim();
    slot.active = true;
    slot.mode = "slash";
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life ?? 0.15);
    slot.x = opts.x;
    slot.y = opts.y;
    slot.vx = 0;
    slot.vy = 0;
    slot.rotationSpeed = 0;
    slot.startAlpha = opts.alpha ?? 0.55;
    slot.g.visible = true;
    slot.g.rotation = 0;
    slot.g.position.set(slot.x, slot.y);
    slot.g.alpha = slot.startAlpha;
    drawCrescentShape(
      slot.g,
      opts.angle,
      opts.sweep ?? 1.1,
      safeRadius(opts.radius ?? 22),
      Math.max(1, opts.thickness ?? 5),
      opts.color,
    );
  }

  /** A small rotating chip flung outward by the crescent-nova spin (item 6). */
  spawnShard(opts: SpawnShardOptions): void {
    const slot = this.claim();
    slot.active = true;
    slot.mode = "shard";
    slot.age = 0;
    slot.life = Math.max(0.05, opts.life ?? 0.45);
    slot.x = opts.x;
    slot.y = opts.y;
    const speed = opts.speed ?? 160;
    slot.vx = Math.cos(opts.angle) * speed;
    slot.vy = Math.sin(opts.angle) * speed;
    slot.rotationSpeed = opts.rotationSpeed ?? 6;
    slot.startAlpha = 0.85;
    slot.g.visible = true;
    slot.g.rotation = opts.angle;
    slot.g.position.set(slot.x, slot.y);
    slot.g.alpha = slot.startAlpha;
    drawCrescentShape(
      slot.g,
      0,
      1.3,
      safeRadius(opts.radius ?? 7),
      Math.max(1, opts.thickness ?? 3),
      opts.color,
    );
  }

  /** Advance every live crescent by `dt` real seconds. */
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
      if (slot.mode === "shard") {
        slot.x += slot.vx * dt;
        slot.y += slot.vy * dt;
        slot.g.rotation += slot.rotationSpeed * dt;
        slot.g.position.set(slot.x, slot.y);
      }
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

/** Build the annulus-segment poly for `g` in its OWN local space, centered on
 * `sweepAngle` — called once per spawn; `update()` never re-walks this path. */
function drawCrescentShape(
  g: Graphics,
  sweepAngle: number,
  sweep: number,
  rOuter: number,
  thickness: number,
  color: number,
): void {
  g.clear();
  const half = sweep / 2;
  const start = sweepAngle - half;
  const end = sweepAngle + half;
  const rInner = safeRadius(rOuter - thickness);
  const pts: number[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const a = start + ((end - start) * i) / ARC_SEGMENTS;
    pts.push(Math.cos(a) * rOuter, Math.sin(a) * rOuter);
  }
  for (let i = ARC_SEGMENTS; i >= 0; i--) {
    const a = start + ((end - start) * i) / ARC_SEGMENTS;
    pts.push(Math.cos(a) * rInner, Math.sin(a) * rInner);
  }
  g.poly(pts, true).fill({ color, alpha: 1 });
}
