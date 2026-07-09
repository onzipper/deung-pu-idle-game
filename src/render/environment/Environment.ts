/**
 * Biome/background orchestrator — the `background` layer's sole owner.
 * Replaces the old static sky/ground fill with a live parallax scene that
 * crossfades to a new `BiomeScene` whenever the current ZONE (`zoneAt(
 * state.location)`, M6 "World & Town") resolves to a new biome slot
 * (`biomes.ts` `biomeForZone`) — town/farm-escalation/boss-room are each their
 * own themed biome per map, so walking to a new zone (or into the boss room)
 * naturally crossfades the whole scene, not just a raw stage-number change.
 *
 * Zone-change detection is a plain key comparison each `update()` (robust to
 * `zoneEntered`/`bossRoomEntered` AND any other way `state.location` could
 * jump, e.g. a fresh load) rather than depending on `frameEvents` alone.
 *
 * Motion here is real-seconds-based throughout (see `BiomeScene`/`ParallaxLayer`/
 * `AmbientField`) so the 1x/2x/3x game-speed multiplier never fast-forwards
 * the scenery — only the `battle`/`boss` PHASE (not speed) nudges the
 * "world travel" scroll pace, per the task spec.
 */

import type { Container } from "pixi.js";
import type { Zone } from "@/engine";
import type { GameState } from "@/engine/state";
import { zoneAt } from "@/engine";
import { biomeForZone, type ResolvedBiome } from "@/render/environment/biomes";
import { BiomeScene } from "@/render/environment/BiomeScene";
import { terrainForZone } from "@/render/worldDepth/terrainZone";

/** Seconds for an old->new biome crossfade. */
const TRANSITION_DURATION = 1.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Scroll-pace multiplier. Since the zone-hunting rework the camera is FIXED
 * inside a zone — the field must stand still while the hero runs around it
 * (a scrolling ground under a stationary fight read as "the floor is moving",
 * owner-reported 2026-07-06). The world-travel scroll now plays ONLY while
 * `state.traveling` is set (walking between zones), selling the journey;
 * clouds/ambient drift are unaffected (they're weather, not travel). */
function speedMulFor(state: GameState): number {
  return state.traveling ? 1.15 : 0;
}

export class Environment {
  private current: BiomeScene | null = null;
  private currentKey: string | null = null;
  private incoming: BiomeScene | null = null;
  private incomingKey: string | null = null;
  private transitionT = 0;
  /** W3 "โลกมีมิติ" terrain ground layer — default OFF (today's flat look).
   * `GameRenderer` flips this via its own `worldFx`-style setter (W5/W6
   * wiring, not yet connected). `BiomeScene` itself still decides flat-vs-
   * polygon PER ZONE (see its doc comment) — this only controls whether a
   * `Terrain` is resolved and offered to it at all. */
  private terrainEnabled = false;

  constructor(private readonly container: Container) {}

  /** Turn the terrain ground layer on/off. A flag flip that actually changes
   * the value busts `currentKey` so the NEXT `update()` spawns a fresh
   * `incoming` scene (even though the zone key itself hasn't changed) and the
   * existing 1s crossfade animates the on/off swap, the same way a zone
   * change already does. (If a zone-change crossfade is already in flight
   * when the flag flips, the bust is superseded by that transition's own
   * completion — a rare interleaving that a following zone change or flag
   * flip resolves; not worth a queue for a settings toggle.) */
  setTerrainEnabled(on: boolean): void {
    if (this.terrainEnabled === on) return;
    this.terrainEnabled = on;
    this.currentKey = null;
  }

  /** Advance scenery by `dt` REAL seconds and react to the live `state`. */
  update(dt: number, state: GameState): void {
    const zone = zoneAt(state.location);
    const resolved = biomeForZone(zone);

    if (!this.current) {
      this.current = this.spawn(resolved, zone, state);
      this.currentKey = resolved.key;
    } else if (resolved.key !== this.currentKey && !this.incoming) {
      this.incoming = this.spawn(resolved, zone, state);
      this.incomingKey = resolved.key;
      this.transitionT = 0;
    }

    const speedMul = speedMulFor(state);
    this.current.update(dt, speedMul, state);

    if (this.incoming) {
      this.incoming.update(dt, speedMul, state);
      this.transitionT += dt;
      const t = clamp01(this.transitionT / TRANSITION_DURATION);
      this.incoming.view.alpha = t;
      this.current.view.alpha = 1 - t;
      if (t >= 1) {
        this.current.destroy();
        this.current = this.incoming;
        this.currentKey = this.incomingKey;
        this.current.view.alpha = 1;
        this.incoming = null;
        this.incomingKey = null;
      }
    }
  }

  destroy(): void {
    this.current?.destroy();
    this.incoming?.destroy();
    this.current = null;
    this.incoming = null;
  }

  private spawn(resolved: ResolvedBiome, zone: Zone, state: GameState): BiomeScene {
    const terrain = this.terrainEnabled ? terrainForZone(zone) : undefined;
    const scene = new BiomeScene(resolved, zone, state, { terrain });
    this.container.addChild(scene.view);
    return scene;
  }
}
