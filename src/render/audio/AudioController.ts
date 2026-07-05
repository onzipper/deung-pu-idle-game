/**
 * The M4 SFX orchestrator — audio's equivalent of `render/fx/FxController`.
 *
 * One-way, read-only consumer of the engine's per-frame `GameEvent[]` buffer
 * (see `engine/state/events.ts`): `consumeEvents()` reacts to what just
 * happened by switching on `ev.type` (same shape as `FxController`'s switch)
 * and, if the per-event-type throttle gate allows it, plays the matching
 * `sfxMap.ts` recipe through the shared `AudioEngine`.
 *
 * Owns exactly one `AudioEngine` instance. `resume()` must be wired to fire
 * from inside a real user-gesture handler (see `GameClient.tsx`'s pointerdown
 * listener) — this class does not itself listen for DOM events, keeping it
 * mountable/testable independent of any specific integration.
 */

import type { GameEvent } from "@/engine";
import { AudioEngine } from "@/render/audio/AudioEngine";
import { SFX_MIN_INTERVAL_MS } from "@/render/audio/sfxMap";
import {
  playBossDefeated,
  playBossEnraged,
  playBossRetreat,
  playBossSlamLand,
  playBossSlamTelegraph,
  playEvolve,
  playHeroDown,
  playHeroRevived,
  playHit,
  playKill,
  playLevelUp,
  playSkillCast,
  playStageAdvanced,
} from "@/render/audio/sfxMap";

export class AudioController {
  private readonly engine = new AudioEngine();

  /** Must be called from inside a real user-gesture event handler (browsers
   * block audio autoplay until one fires). Cheap/safe to call repeatedly. */
  resume(): void {
    this.engine.resume();
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
  }

  setVolume(v: number): void {
    this.engine.setVolume(v);
  }

  get isMuted(): boolean {
    return this.engine.isMuted;
  }

  /** React to this frame's (already-collected, cross-sub-step) events. */
  consumeEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case "hit":
          // Split by target so heroes-taking-damage and enemies-taking-damage
          // each get their own throttle budget (one side spamming never
          // starves the other's audibility).
          if (this.engine.allow(`hit:${ev.target}`, SFX_MIN_INTERVAL_MS.hit)) {
            playHit(this.engine, ev);
          }
          break;
        case "kill":
          if (this.engine.allow("kill", SFX_MIN_INTERVAL_MS.kill)) {
            playKill(this.engine);
          }
          break;
        case "heroDown":
          if (this.engine.allow("heroDown", SFX_MIN_INTERVAL_MS.heroDown)) {
            playHeroDown(this.engine);
          }
          break;
        case "heroRevived":
          if (this.engine.allow("heroRevived", SFX_MIN_INTERVAL_MS.heroRevived)) {
            playHeroRevived(this.engine);
          }
          break;
        case "skillCast":
          // Per-class throttle key so e.g. the archer's cooldown doesn't gate
          // the swordsman's next cast.
          if (
            this.engine.allow(`skillCast:${ev.heroClass}`, SFX_MIN_INTERVAL_MS.skillCast)
          ) {
            playSkillCast(this.engine, ev);
          }
          break;
        case "bossSlamTelegraph":
          if (
            this.engine.allow("bossSlamTelegraph", SFX_MIN_INTERVAL_MS.bossSlamTelegraph)
          ) {
            playBossSlamTelegraph(this.engine);
          }
          break;
        case "bossSlamLand":
          if (this.engine.allow("bossSlamLand", SFX_MIN_INTERVAL_MS.bossSlamLand)) {
            playBossSlamLand(this.engine);
          }
          break;
        case "bossEnraged":
          if (this.engine.allow("bossEnraged", SFX_MIN_INTERVAL_MS.bossEnraged)) {
            playBossEnraged(this.engine);
          }
          break;
        case "bossDefeated":
          if (this.engine.allow("bossDefeated", SFX_MIN_INTERVAL_MS.bossDefeated)) {
            playBossDefeated(this.engine);
          }
          break;
        case "bossRetreat":
          if (this.engine.allow("bossRetreat", SFX_MIN_INTERVAL_MS.bossRetreat)) {
            playBossRetreat(this.engine);
          }
          break;
        case "stageAdvanced":
          if (this.engine.allow("stageAdvanced", SFX_MIN_INTERVAL_MS.stageAdvanced)) {
            playStageAdvanced(this.engine);
          }
          break;
        case "levelUp":
          if (this.engine.allow("levelUp", SFX_MIN_INTERVAL_MS.levelUp)) {
            playLevelUp(this.engine);
          }
          break;
        case "evolve":
          if (this.engine.allow("evolve", SFX_MIN_INTERVAL_MS.evolve)) {
            playEvolve(this.engine);
          }
          break;
        default:
          break; // waveSpawn / projectileSpawn / stageCleared: silent by design (see sfxMap.ts)
      }
    }
  }

  /** Full teardown — closes the underlying `AudioContext`. */
  destroy(): void {
    this.engine.destroy();
  }
}
