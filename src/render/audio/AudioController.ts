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
import { ITEM_TEMPLATES } from "@/engine/config/items";
import { AudioEngine } from "@/render/audio/AudioEngine";
import { SFX_MIN_INTERVAL_MS } from "@/render/audio/sfxMap";
import {
  playBossDefeated,
  playBossDoorUnlocked,
  playBossEnraged,
  playBossRoomEntered,
  playBossSlamLand,
  playBossSlamTelegraph,
  playEvolve,
  playFastTravelArrive,
  playFastTravelCastStart,
  playFastTravelFizzle,
  playHeroDown,
  playHeroRevived,
  playHeroWalkHome,
  playHit,
  playItemDrop,
  playKill,
  playLevelUp,
  playMobAggroed,
  playSkillCast,
  playStageAdvanced,
} from "@/render/audio/sfxMap";
import { isBossZoneIdx } from "@/render/environment/zoneGates";

export class AudioController {
  private readonly engine = new AudioEngine();
  /** Mirrors `fx/travelPortal.ts`'s own channel tracking (audio has no access
   * to that render-only state) — lets `fastTravelBlocked` tell "a real
   * mid-channel cancel" apart from "an intent that never started a channel"
   * (e.g. tapping a locked zone), so the fizzle dud only plays for the former. */
  private fastTravelChanneling = false;

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
            // M6 "World & Town": always chase the sting with the somber
            // "walking home" tail (see `sfxMap.ts`'s `playHeroWalkHome` doc
            // comment) — solo play means every heroDown is a full wipe today.
            playHeroWalkHome(this.engine);
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
        // M7.9 boss-variety mechanics (maps 4-6, render/audio follow-up for
        // 993c315): reuse the closest existing recipe rather than composing
        // new ones — own throttle-key namespace (see sfxMap.ts's doc comment).
        case "bossChargeTelegraph":
          if (
            this.engine.allow("bossChargeTelegraph", SFX_MIN_INTERVAL_MS.bossChargeTelegraph)
          ) {
            playBossSlamTelegraph(this.engine);
          }
          break;
        case "bossChargeHit":
          if (this.engine.allow("bossChargeHit", SFX_MIN_INTERVAL_MS.bossChargeHit)) {
            playBossSlamLand(this.engine);
          }
          break;
        case "bossSummon":
          if (this.engine.allow("bossSummon", SFX_MIN_INTERVAL_MS.bossSummon)) {
            playMobAggroed(this.engine);
          }
          break;
        case "bossHazardWarn":
          if (this.engine.allow("bossHazardWarn", SFX_MIN_INTERVAL_MS.bossHazardWarn)) {
            playBossSlamTelegraph(this.engine);
          }
          break;
        case "bossHazardStrike":
          if (this.engine.allow("bossHazardStrike", SFX_MIN_INTERVAL_MS.bossHazardStrike)) {
            playBossSlamLand(this.engine);
          }
          break;
        case "bossDefeated":
          if (this.engine.allow("bossDefeated", SFX_MIN_INTERVAL_MS.bossDefeated)) {
            playBossDefeated(this.engine);
          }
          break;
        case "bossRoomEntered":
          if (this.engine.allow("bossRoomEntered", SFX_MIN_INTERVAL_MS.bossRoomEntered)) {
            playBossRoomEntered(this.engine);
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
        case "mobAggroed":
          // Shared (not per-mob) throttle key — several mobs aggroing the
          // same instant on a busy field collapse into one short bark.
          if (this.engine.allow("mobAggroed", SFX_MIN_INTERVAL_MS.mobAggroed)) {
            playMobAggroed(this.engine);
          }
          break;
        case "itemDrop":
          // Shared throttle key — a farm kill can fire these often on a busy
          // field; several drops in the same instant collapse into one chime.
          if (this.engine.allow("itemDrop", SFX_MIN_INTERVAL_MS.itemDrop)) {
            playItemDrop(this.engine, ITEM_TEMPLATES[ev.templateId]?.rarity ?? "common");
          }
          break;
        case "zoneUnlocked":
          // The general case stays silent (see sfxMap.ts's module doc
          // comment); the boss-door-unlock EXCEPTION gets its own low drone.
          if (
            isBossZoneIdx(ev.mapId, ev.zoneIdx) &&
            this.engine.allow("bossDoorUnlocked", SFX_MIN_INTERVAL_MS.bossDoorUnlocked)
          ) {
            playBossDoorUnlocked(this.engine);
          }
          break;
        case "fastTravelCastStart":
          this.fastTravelChanneling = true;
          if (this.engine.allow("fastTravelCastStart", SFX_MIN_INTERVAL_MS.fastTravelCastStart)) {
            playFastTravelCastStart(this.engine);
          }
          break;
        case "fastTravelArrive":
          this.fastTravelChanneling = false;
          if (this.engine.allow("fastTravelArrive", SFX_MIN_INTERVAL_MS.fastTravelArrive)) {
            playFastTravelArrive(this.engine);
          }
          break;
        case "fastTravelBlocked":
          if (
            this.fastTravelChanneling &&
            this.engine.allow("fastTravelFizzle", SFX_MIN_INTERVAL_MS.fastTravelFizzle)
          ) {
            playFastTravelFizzle(this.engine);
          }
          this.fastTravelChanneling = false;
          break;
        default:
          break; // projectileSpawn / stageCleared / zoneEntered / zoneGateEnter /
          // zoneGateExit / mapUnlocked / townArrived: silent by design — the
          // same high-frequency-event fatigue reasoning as waveSpawn
          // (zoneEntered/zoneGateEnter fire every zone-to-zone hop), and
          // zoneUnlocked/mapUnlocked already get their moment via
          // FxController's visual-only sparkle (see sfxMap.ts's module doc
          // comment for the general policy + the boss-door exception above).
      }
    }
  }

  /** Full teardown — closes the underlying `AudioContext`. */
  destroy(): void {
    this.engine.destroy();
  }
}
