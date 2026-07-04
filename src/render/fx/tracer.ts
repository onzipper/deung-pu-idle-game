/**
 * Pooled light-trail tracer for in-flight hero projectiles (HERO SIGNATURE
 * PASS items 7/10/11: arrow tracer, mage-colored orb wisp trail, thicker
 * meteor fire trail). Continuous, state-driven — like `weaponTrail.ts`'s
 * sword ribbon, generalized to N independently-tracked projectiles instead of
 * one sword tip: `syncFrame()` is fed the CURRENT `state.projectiles` list
 * every `FxController.update()` call and binds/frees pool tracks by
 * projectile id, since a projectile's whole flight has no discrete per-frame
 * event of its own to react to.
 *
 * Each bound track keeps a tiny fixed-size ring buffer of recently-sampled
 * points, redrawn as a tapering fading polyline — the exact same technique
 * `weaponTrail.ts`'s ribbon uses, just per-projectile instead of per-sword.
 */

import { Container, Graphics } from "pixi.js";
import type { Projectile } from "@/engine/entities";
import { safeRadius } from "@/render/theme";

/** Total concurrent tracked projectiles sharing this pool (spec: "tracers ~24"). */
const MAX_TRACKS = 24;
/** Sampled trail points per track — a short comet tail, not a stiff segment. */
const POINTS_PER_TRACK = 5;
/** Real seconds a sampled point stays visible before fully fading. */
const POINT_LIFE = 0.1;

export interface TracerStyle {
  color: number;
  width: number;
  alpha: number;
}

interface TracerPoint {
  x: number;
  y: number;
  age: number;
}

interface TracerTrack {
  /** -1 = free slot. */
  id: number;
  /** The bound projectile disappeared this frame — stop sampling new points,
   * let the existing ones decay, then free the slot once fully faded. */
  orphaned: boolean;
  points: TracerPoint[];
  head: number;
  count: number;
  g: Graphics;
  style: TracerStyle;
}

export class TracerPool {
  private readonly tracks: TracerTrack[];

  constructor(
    private readonly container: Container,
    cap: number = MAX_TRACKS,
  ) {
    this.tracks = Array.from({ length: cap }, () => ({
      id: -1,
      orphaned: false,
      points: Array.from({ length: POINTS_PER_TRACK }, () => ({
        x: 0,
        y: 0,
        age: POINT_LIFE + 1,
      })),
      head: 0,
      count: 0,
      g: new Graphics(),
      style: { color: 0xffffff, width: 2, alpha: 0.6 },
    }));
    for (const t of this.tracks) container.addChild(t.g);
  }

  /**
   * Bind/refresh/free tracks against this frame's live projectiles, then
   * redraw every bound track. `styleFor` returns `null` for any projectile
   * this pool shouldn't track (e.g. enemy bolts) — checked BEFORE the (more
   * expensive) track lookup, so irrelevant projectiles are nearly free to skip.
   */
  syncFrame(
    live: readonly Projectile[],
    styleFor: (p: Projectile) => TracerStyle | null,
    dt: number,
  ): void {
    const liveIds = new Set<number>();
    for (const p of live) {
      if (styleFor(p)) liveIds.add(p.id);
    }
    // Mark tracks whose projectile is gone this frame as orphaned — they
    // keep decaying below like any other trail, just with no new samples.
    for (const t of this.tracks) {
      if (t.id !== -1 && !liveIds.has(t.id)) t.orphaned = true;
    }

    for (const p of live) {
      const style = styleFor(p);
      if (!style) continue;
      let track = this.tracks.find((t) => t.id === p.id);
      if (!track) {
        track = this.tracks.find((t) => t.id === -1);
        if (!track) continue; // pool full — drop (capped by design)
        track.id = p.id;
        track.orphaned = false;
        track.count = 0;
        track.head = 0;
      }
      track.style = style;
      this.pushPoint(track, p.x, p.y);
    }

    for (const t of this.tracks) this.advanceTrack(t, dt);
  }

  private pushPoint(track: TracerTrack, x: number, y: number): void {
    const slot = track.points[track.head];
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    track.head = (track.head + 1) % track.points.length;
    if (track.count < track.points.length) track.count++;
  }

  private advanceTrack(track: TracerTrack, dt: number): void {
    let anyLive = false;
    for (const p of track.points) {
      if (p.age <= POINT_LIFE) {
        p.age += dt;
        if (p.age <= POINT_LIFE) anyLive = true;
      }
    }

    track.g.clear();
    if (anyLive && track.count >= 2) {
      const oldestIdx = (track.head - track.count + track.points.length) % track.points.length;
      let prev: TracerPoint | null = null;
      for (let k = 0; k < track.count; k++) {
        const p = track.points[(oldestIdx + k) % track.points.length];
        if (p.age > POINT_LIFE) {
          prev = null; // stale slot — break the segment chain
          continue;
        }
        if (prev) {
          const frac = 1 - Math.max(0, Math.min(1, p.age / POINT_LIFE));
          const width = safeRadius(track.style.width * frac);
          const alpha = track.style.alpha * frac;
          if (alpha > 0.01) {
            track.g
              .moveTo(prev.x, prev.y)
              .lineTo(p.x, p.y)
              .stroke({ width, color: track.style.color, alpha, cap: "round" });
          }
        }
        prev = p;
      }
    } else if (track.orphaned) {
      // Fully decayed and no longer tracking a live projectile — free it.
      track.id = -1;
      track.orphaned = false;
    }
  }

  destroy(): void {
    for (const t of this.tracks) {
      this.container.removeChild(t.g);
      t.g.destroy();
    }
    this.tracks.length = 0;
  }
}
