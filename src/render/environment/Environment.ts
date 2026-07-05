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
import type { GameState } from "@/engine/state";
import { zoneAt } from "@/engine";
import { biomeForZone, type ResolvedBiome } from "@/render/environment/biomes";
import { BiomeScene } from "@/render/environment/BiomeScene";

/** Seconds for an old->new biome crossfade. */
const TRANSITION_DURATION = 1.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Scroll-pace multiplier per high-level phase — battle pushes forward
 * fastest (the team advancing on the wave), boss is a calmer standoff,
 * victory eases off entirely. */
function speedMulForPhase(phase: GameState["phase"]): number {
  switch (phase) {
    case "battle":
      return 1.15;
    case "boss":
      return 0.55;
    case "victory":
      return 0.8;
    default:
      return 1;
  }
}

export class Environment {
  private current: BiomeScene | null = null;
  private currentKey: string | null = null;
  private incoming: BiomeScene | null = null;
  private incomingKey: string | null = null;
  private transitionT = 0;

  constructor(private readonly container: Container) {}

  /** Advance scenery by `dt` REAL seconds and react to the live `state`. */
  update(dt: number, state: GameState): void {
    const resolved = biomeForZone(zoneAt(state.location));

    if (!this.current) {
      this.current = this.spawn(resolved);
      this.currentKey = resolved.key;
    } else if (resolved.key !== this.currentKey && !this.incoming) {
      this.incoming = this.spawn(resolved);
      this.incomingKey = resolved.key;
      this.transitionT = 0;
    }

    const speedMul = speedMulForPhase(state.phase);
    this.current.update(dt, speedMul);

    if (this.incoming) {
      this.incoming.update(dt, speedMul);
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

  private spawn(resolved: ResolvedBiome): BiomeScene {
    const scene = new BiomeScene(resolved);
    this.container.addChild(scene.view);
    return scene;
  }
}
