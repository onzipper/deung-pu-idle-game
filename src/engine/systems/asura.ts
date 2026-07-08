/**
 * ดินแดนอสูร (ASURA) hard-map systems (endgame v1, docs/endgame-design.md).
 *
 * The asura map is `world.maps[6]` (id "asura", stages 31-40) — a 10-zone hard endgame
 * run gated behind the s30 boss. Its ZONE / hunt / combat machinery is 100% reused from
 * maps 1-6; THIS module owns the endgame-v1 ACCRUAL systems layered on top:
 *
 *  1. UNLOCK GATE (`isAsuraUnlocked`) — asura z1 is persist-unlocked exactly when the s30
 *     boss room clear ran `onBossRoomCleared` (which appended-map6 → asura z1). A read helper
 *     following the `tier3GateCleared` precedent (the UI shows the asura warp tab off it).
 *  2. DEPTH-LADDER difficulty — lives in CONFIG (folded into enemyHp/enemyAtk); this module
 *     only exposes the band read (`asuraRefineBandForStage`).
 *  3. ELITE roaming mob — a DETERMINISTIC rare spawn (a plain counter cadence, `shouldSpawnElite`
 *     / `promoteElite`), so it never draws from the seeded wave-composition stream (no
 *     combat-RNG contamination). Boosted stats + a big xp/gold/stone burst + แก่นอสูร essence
 *     on kill. It stays a NORMAL enemy for targeting (spread rules apply — NOT a boss dog-pile).
 *  4. แก่นอสูร ESSENCE + ศิลาโซน per-zone kill counters (`onAsuraFarmKill`) — plain COUNTS banked
 *     on the save (SAVE v19). Essence accrues WITHOUT touching the gear/stone loot streams (no
 *     lootCounter tick, no RNG draw), so those sequences stay byte-identical.
 *  5. DAILY HOT ZONE — a pure schedule split mirroring the world boss: `asuraHotZoneFor(dayKey)`
 *     (client-side, FNV over the Bangkok day-key) picks one of the 10 zones; the client injects the
 *     day-key via `setAsuraHotZone` and the engine applies a deterministic reward multiplier
 *     (`asuraRewardMult`) to xp/gold/stone earned IN that zone. The engine never reads a clock.
 *
 * PURITY / DETERMINISM: no `Math.random`, no wall-clock. The elite cadence uses a transient
 * counter (`state.asuraSpawnTally`); the hot zone uses an intent-fed day-key. Every hook is
 * inert outside asura (stage < 31 / mapId !== "asura"), so the canonical s1-30 sim is byte-identical.
 */

import { CONFIG } from "@/engine/config";
import { zoneAt } from "@/engine/systems/world";
import type { Enemy, WorldLocation } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** The asura map id (contract alias for `CONFIG.asura.mapId`). */
export const ASURA_MAP_ID = CONFIG.asura.mapId;

/** Whether `stage` is an asura stage (31-40) — the map's stages are unique to it. */
export function isAsuraStage(stage: number): boolean {
  return stage >= CONFIG.asura.stageBase;
}

/** Whether `loc` addresses the asura map. */
export function isAsuraLocation(loc: WorldLocation): boolean {
  return loc.mapId === ASURA_MAP_ID;
}

/**
 * Whether ดินแดนอสูร is unlocked for this save — asura z1 is persist-unlocked, which happens
 * exactly when the s30 boss room clear ran `onBossRoomCleared` (asura is appended after map6, so
 * that map-gate opens asura z1). Follows the `tier3GateCleared` precedent: a pure read of the
 * persisted `unlockedZones` count, so the UI can gate the asura warp tab / entrance without a
 * separate flag. Deterministic (no RNG / wall-clock).
 */
export function isAsuraUnlocked(state: GameState): boolean {
  return (state.unlockedZones[ASURA_MAP_ID] ?? 0) >= 1;
}

/** The refine level the asura zone at `stage` targets (its depth band), or null off-map. */
export function asuraRefineBandForStage(stage: number): number | null {
  if (!isAsuraStage(stage)) return null;
  const depth = Math.max(0, Math.min(CONFIG.asura.farmZones - 1, stage - CONFIG.asura.stageBase));
  const band = CONFIG.asura.refineBands.find((b) => depth >= b.minDepth && depth <= b.maxDepth);
  return band ? band.refine : null;
}

// ---------------------------------------------------------------------------
// Daily hot zone (pure schedule helper — client-side; the engine never reads a clock).
// ---------------------------------------------------------------------------

/**
 * The asura FARM-zone index (`[0, farmZones)`) that runs HOT for a given day — an FNV-1a hash
 * over the Bangkok day-key's decimal digits, mod the farm-zone count. Same shape as
 * `worldBossZoneFor` (the world-boss schedule), so the two derivations read consistently. The
 * CLIENT computes the day-key off its wall clock (Asia/Bangkok server-day, `serverDay` precedent)
 * and passes it via the `setAsuraHotZone` intent; the engine resolves the zone from it here.
 * `farmZones <= 1` → 0 (defensive). Pure (no RNG, no wall-clock).
 */
export function asuraHotZoneFor(dayKey: number): number {
  const count = CONFIG.asura.farmZones;
  if (count <= 1) return 0;
  let h = 0x811c9dc5 >>> 0; // FNV-1a 32-bit offset basis
  const digits = Math.abs(Math.trunc(dayKey)).toString();
  for (let i = 0; i < digits.length; i++) {
    h ^= digits.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // FNV prime
  }
  return h % count;
}

/**
 * Apply a `setAsuraHotZone` intent: resolve + store the day's hot zone index (or clear it with a
 * negative/non-finite day-key). STICKY — a client injects the day-key on zone beats (not every
 * step), so the resolved index persists on `state.asuraHotZone` between intents. Idempotent
 * (a pure deterministic set — all cohort clients pass the same server-agreed day-key). Transient
 * (never persisted; rebuilt null on load).
 */
export function applyAsuraHotZone(state: GameState, dayKey: number): void {
  state.asuraHotZone =
    Number.isFinite(dayKey) && dayKey >= 0 ? asuraHotZoneFor(dayKey) : null;
}

/**
 * The reward multiplier (xp / gold / stone) for a kill at the hero's CURRENT location: the daily
 * hot-zone bonus while standing in the chosen asura farm zone, else 1. Reads only shared state
 * (`asuraHotZone` + `location`), so it is identical on every cohort client. Returns 1 outside
 * asura / when no hot zone is set — so s1-30 (and asura with no daily set) is byte-identical.
 */
export function asuraRewardMult(state: GameState): number {
  const hz = state.asuraHotZone;
  if (hz === null) return 1;
  const loc = state.location;
  if (loc.mapId !== ASURA_MAP_ID) return 1;
  if (zoneAt(loc).kind !== "farm") return 1;
  return loc.zoneIdx === hz ? CONFIG.asura.hotZone.rewardMult : 1;
}

// ---------------------------------------------------------------------------
// Elite roaming mob (deterministic counter cadence — driven from systems/hunt.spawnMob).
// ---------------------------------------------------------------------------

/**
 * Whether the NEXT asura farm spawn should be promoted to an ELITE — advances the transient
 * per-run counter (`state.asuraSpawnTally`) and returns true on every `cadence`-th asura spawn.
 * DETERMINISTIC: a plain counter (NOT a seeded-stream draw), so the spawn composition/placement
 * RNG is unperturbed — the seeded stream stays reserved for wave composition (CLAUDE.md). Only
 * ever called for an asura farm spawn (the caller guards on the map), so the tally stays 0 for
 * s1-30 → those runs never diverge. No-op / false for a non-asura stage (defensive).
 */
export function shouldSpawnElite(state: GameState): boolean {
  if (!isAsuraStage(state.stage)) return false;
  state.asuraSpawnTally++;
  return state.asuraSpawnTally % CONFIG.asura.elite.cadence === 0;
}

/**
 * Promote a freshly-built asura mob to an ELITE (in place): flag it + scale its HP/atk by the
 * config multipliers, and emit an `eliteSpawned` render/announce beat. NO RNG draw (pure config
 * scaling). Its temperament (aggressive/passive) is left as the spawn rolled — an elite "roams"
 * like any mob but is a beefy, high-value target. Called after `makeEnemy` in `spawnMob`.
 */
export function promoteElite(state: GameState, e: Enemy): void {
  const cfg = CONFIG.asura.elite;
  e.elite = true;
  e.hp = Math.round(e.hp * cfg.hpMult);
  e.maxHp = e.hp;
  e.atk = Math.round(e.atk * cfg.atkMult);
  state.events.push({ type: "eliteSpawned", id: e.id, kind: e.kind, x: e.x, y: e.y });
}

// ---------------------------------------------------------------------------
// Kill accrual — แก่นอสูร essence + ศิลาโซน per-zone counters (from combat.resolveDeaths).
// ---------------------------------------------------------------------------

/** The persisted `asuraZoneKills` / lifetime-progress key for `loc` ("asura:zoneIdx"). */
export function asuraZoneKey(loc: WorldLocation): string {
  return `${loc.mapId}:${loc.zoneIdx}`;
}

/**
 * Bank the endgame-v1 ACCRUAL for one asura FARM kill (called from `resolveDeaths` after the
 * ordinary xp/gold/loot for the kill): advance the ศิลาโซน per-zone lifetime counter (emitting
 * `asuraZoneStoneEarned` on the first crossing of `zoneStoneGoal` — the zone's ศิลา is now earned)
 * and, for an ELITE, bank แก่นอสูร essence + emit `eliteKilled`. Essence is a plain COUNT on the
 * save (SAVE v19) incremented directly — NO lootCounter tick and NO RNG draw, so the gear/stone
 * loot streams for this kill stay byte-identical (the isolation invariant). No-op off asura.
 */
export function onAsuraFarmKill(state: GameState, e: Enemy): void {
  if (!isAsuraStage(state.stage)) return;
  const key = asuraZoneKey(state.location);
  const prev = state.asuraZoneKills[key] ?? 0;
  const now = prev + 1;
  state.asuraZoneKills[key] = now;
  const goal = CONFIG.asura.zoneStoneGoal;
  if (prev < goal && now >= goal) {
    state.events.push({
      type: "asuraZoneStoneEarned",
      mapId: state.location.mapId,
      zoneIdx: state.location.zoneIdx,
    });
  }
  if (e.elite) {
    const gained = CONFIG.asura.elite.essence;
    state.asuraEssence += gained;
    state.events.push({ type: "eliteKilled", x: e.x, y: e.y, essence: gained });
  }
}
