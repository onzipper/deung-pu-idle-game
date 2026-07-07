/**
 * WORLD BOSS "เสี่ยจ๋อง" (hourly world boss) — engine wave.
 *
 * An hourly, PARTY-GATED world boss. It spawns at the TOP OF EVERY HOUR in ONE
 * deterministically-chosen FARM zone of `CONFIG.worldBoss.mapId` (map1), lives
 * `lifetimeMs` (15 min), then despawns. Two halves live here:
 *
 *  1. PURE SCHEDULE HELPERS (`worldBossWindowId` / `worldBossPhaseAt` /
 *     `worldBossZoneFor` + the zone-resolution conveniences). The CLIENT calls these
 *     off its wall clock to decide WHEN + WHERE to inject the spawn intent — the ENGINE
 *     never reads a clock (purity). They are ordinary functions of `nowMs`.
 *  2. THE ENGINE HOOK (`applyWorldBossSpawnIntents` / `updateWorldBossAI` /
 *     `resolveWorldBossDeath`), driven from `step()`. The boss lives alongside the
 *     normal farm field in the BATTLE phase, reuses the enemy pipeline (getTargets /
 *     findById) for targeting + hits, and reuses `systems/boss.updateBossEntity` for its
 *     movement + telegraphed mechanics — themed via `state.worldBoss` for render.
 *
 * DETERMINISM: the mechanics use FIXED timing tables (via `updateBossEntity`) — NO seeded
 * RNG-stream draw and NO loot-counter tick — so the normal mob/loot sequences stay
 * BYTE-IDENTICAL with a world boss present. When no `spawnWorldBoss` intent is ever
 * injected, `state.worldBoss` stays null and every hook is a no-op (dormant = the solo
 * canonical sim is byte-identical). The kill grants NO xp/gold and NEVER counts toward
 * killGoal/zoneKills/quests (rewards are SERVER-claimed off `worldBossDefeated`).
 *
 * AGGRO = PASSIVE-until-attacked (owner rule "never farms newbies" — map1 hosts NEW
 * players): the boss idles at the spawn edge and does not approach/attack until a hero
 * has DAMAGED it (detected as `entity.hp < entity.maxHp`, since nothing else can hurt it).
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { makeWorldBoss } from "@/engine/entities";
import type { WorldBossState } from "@/engine/entities";
import { updateBossEntity } from "@/engine/systems/boss";
import { WORLD_ZONES, zoneAt } from "@/engine/systems/world";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

/** The world-boss knobs (contract alias for `CONFIG.worldBoss`). */
export const WORLD_BOSS = CONFIG.worldBoss;

/** The reusable boss-mechanic kit for the world boss (charge + hazard only; the summon
 *  slot is inert — the world boss carries no "summon" behavior, so it never runs). */
const WORLD_BOSS_KIT = {
  move: WORLD_BOSS.boss,
  behavior: {
    charge: WORLD_BOSS.bossBehavior.charge,
    hazard: WORLD_BOSS.bossBehavior.hazard,
    // Never invoked (no "summon" in `behaviors`) — reuse the stage-boss table for the type.
    summon: CONFIG.bossBehavior.summon,
  },
};

// ---------------------------------------------------------------------------
// Pure schedule helpers (client-side; the engine never reads a wall clock).
// ---------------------------------------------------------------------------

/** The hour-window index a wall-clock `nowMs` falls in: `floor(nowMs / periodMs)`. */
export function worldBossWindowId(nowMs: number): number {
  return Math.floor(nowMs / WORLD_BOSS.periodMs);
}

/** The world-boss lifecycle phase at a wall-clock `nowMs`. */
export interface WorldBossPhase {
  /** "active" for the first `lifetimeMs` of the hour; "pre" during the last
   *  `preAnnounceMs` before the NEXT hour; "idle" otherwise. */
  phase: "idle" | "pre" | "active";
  /** The window the phase refers to: the CURRENT hour when active, the UPCOMING hour
   *  when pre/idle (the one whose spawn the client is waiting on). */
  windowId: number;
  /** ms until the NEXT spawn (0 while active — already spawned). */
  msToSpawn: number;
  /** ms the ACTIVE boss has left before it despawns (full `lifetimeMs` while pre; 0 idle). */
  msRemaining: number;
}

/**
 * Resolve the world-boss schedule at wall-clock `nowMs` (pure). "active" = the first
 * `lifetimeMs` of the hour (its boss is live); "pre" = the `preAnnounceMs` window right
 * before the next hour (a countdown to the upcoming spawn); "idle" = neither. Boundaries
 * are half-open: active is `[hourStart, hourStart+lifetimeMs)`, pre is
 * `[nextHour-preAnnounceMs, nextHour)`.
 */
export function worldBossPhaseAt(nowMs: number): WorldBossPhase {
  const period = WORLD_BOSS.periodMs;
  const cur = Math.floor(nowMs / period);
  const pos = nowMs - cur * period; // [0, period) — ms since this hour began
  if (pos < WORLD_BOSS.lifetimeMs) {
    return { phase: "active", windowId: cur, msToSpawn: 0, msRemaining: WORLD_BOSS.lifetimeMs - pos };
  }
  const msToNext = period - pos; // (0, period - lifetimeMs] — ms until the next hour
  if (msToNext <= WORLD_BOSS.preAnnounceMs) {
    return { phase: "pre", windowId: cur + 1, msToSpawn: msToNext, msRemaining: WORLD_BOSS.lifetimeMs };
  }
  return { phase: "idle", windowId: cur + 1, msToSpawn: msToNext, msRemaining: 0 };
}

/**
 * The FARM-zone ORDINAL (in `[0, farmZoneCount)`) a window's boss occupies — an FNV-1a
 * hash over the windowId's decimal digits, mod `farmZoneCount`, so successive windows
 * spread deterministically across the map's farm zones. `farmZoneCount <= 1` → 0.
 */
export function worldBossZoneFor(windowId: number, farmZoneCount: number): number {
  if (farmZoneCount <= 1) return 0;
  let h = 0x811c9dc5 >>> 0; // FNV-1a 32-bit offset basis
  const digits = Math.abs(Math.trunc(windowId)).toString();
  for (let i = 0; i < digits.length; i++) {
    h ^= digits.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // FNV prime
  }
  return h % farmZoneCount;
}

/** The FARM zones of the world-boss map, in world (left-to-right) order. */
export function worldBossFarmZones(): { mapId: string; zoneIdx: number }[] {
  return WORLD_ZONES.filter((z) => z.mapId === WORLD_BOSS.mapId && z.kind === "farm").map((z) => ({
    mapId: z.mapId,
    zoneIdx: z.zoneIdx,
  }));
}

/**
 * The world LOCATION a window's boss spawns in (the chosen farm zone), or null if the
 * map has no farm zones. The client uses this to know which zone the player must stand
 * in to trigger the spawn; the engine uses it in the spawn guard.
 */
export function worldBossLocationFor(windowId: number): { mapId: string; zoneIdx: number } | null {
  const farms = worldBossFarmZones();
  if (farms.length === 0) return null;
  return farms[worldBossZoneFor(windowId, farms.length)];
}

// ---------------------------------------------------------------------------
// Engine hook (driven from step()).
// ---------------------------------------------------------------------------

/** The world boss's live entity target for the enemy pipeline, or null. Read by
 *  `getTargets` (heroes acquire + AoE it) and `findById` (homing arrows/bolts hit it). */
export function activeWorldBoss(state: GameState) {
  const wb = state.worldBoss;
  return wb && wb.active ? wb.entity : null;
}

/** Retire the world boss's entity (keeps the windowId record so it can't respawn this
 *  window). `defeated` distinguishes a kill from a despawn (lifetime / zone-leave). */
function retireWorldBoss(state: GameState, wb: WorldBossState, defeated: boolean): void {
  wb.active = false;
  wb.entity = null;
  if (defeated) wb.defeated = true;
  state.events.push({
    type: defeated ? "worldBossDefeated" : "worldBossDespawned",
    windowId: wb.windowId,
  });
}

/**
 * Try to spawn the world boss for `windowId` (idempotent). Spawns iff: the hero is in
 * the BATTLE phase, standing in the world-boss map's chosen farm zone for this window,
 * `remainingSeconds > 0`, and no boss for this windowId was already spawned/handled this
 * session AND none is currently active. Seeds the lifetime countdown from
 * `remainingSeconds` (capped at the configured lifetime). Returns true on a fresh spawn.
 */
function trySpawnWorldBoss(state: GameState, windowId: number, remainingSeconds: number): boolean {
  if (state.phase !== "battle") return false;
  if (!Number.isFinite(windowId) || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return false;
  }
  const wb = state.worldBoss;
  // Idempotent: this window already handled (spawned/defeated/despawned), or another
  // window's boss is still active (one at a time). A cohort's several members may all
  // inject the same intent — the first ordered lane wins; the rest no-op here.
  if (wb && (wb.windowId === windowId || wb.active)) return false;
  const loc = worldBossLocationFor(windowId);
  if (!loc) return false;
  if (state.location.mapId !== loc.mapId || state.location.zoneIdx !== loc.zoneIdx) return false;
  if (zoneAt(state.location).kind !== "farm") return false;

  const countdown = Math.min(remainingSeconds, WORLD_BOSS.lifetimeMs / 1000);
  state.worldBoss = {
    windowId,
    mapId: loc.mapId,
    zoneIdx: loc.zoneIdx,
    active: true,
    defeated: false,
    countdown,
    entity: makeWorldBoss(state.nextId++),
  };
  state.events.push({ type: "worldBossSpawned", windowId });
  return true;
}

/**
 * Apply this step's `spawnWorldBoss` intents from EVERY lane in slot order (cohort
 * first-wins is deterministic: all clients receive the same ordered lane vector, so the
 * winning lane's `remainingSeconds` seeds the same countdown everywhere). Solo = lane 0.
 */
export function applyWorldBossSpawnIntents(state: GameState, lanes: FrameInput[]): void {
  for (const lane of lanes) {
    const intent = lane?.spawnWorldBoss;
    if (intent) trySpawnWorldBoss(state, intent.windowId, intent.remainingSeconds);
  }
}

/**
 * Tick the world boss's despawn + AI one fixed BATTLE step. Despawns if the hero left
 * its zone / the phase is no longer battle, or its lifetime countdown expired; otherwise
 * runs the boss movement + mechanics via `updateBossEntity` — but only once ENGAGED
 * (a hero has damaged it), so it stays passive until attacked (never farms newbies).
 */
export function updateWorldBossAI(state: GameState): void {
  const wb = state.worldBoss;
  if (!wb || !wb.active || !wb.entity) return;

  // Zone-leave / phase-change despawn (transient battlefield content).
  if (
    state.phase !== "battle" ||
    state.location.mapId !== wb.mapId ||
    state.location.zoneIdx !== wb.zoneIdx
  ) {
    retireWorldBoss(state, wb, false);
    return;
  }

  // Lifetime countdown → despawn at 0.
  wb.countdown -= FIXED_DT;
  if (wb.countdown <= 0) {
    retireWorldBoss(state, wb, false);
    return;
  }

  // Passive-until-attacked: idle at the spawn edge until a hero has damaged it.
  if (wb.entity.hp < wb.entity.maxHp) {
    updateBossEntity(state, wb.entity, WORLD_BOSS_KIT.move, WORLD_BOSS_KIT.behavior);
  }
}

/**
 * Resolve a world-boss death (call AFTER hero damage has landed this step). On hp ≤ 0
 * it emits `worldBossDefeated` and retires the entity — NO xp/gold, NO kill-quota /
 * quest credit (rewards are SERVER-claimed off the event). A no-op otherwise.
 */
export function resolveWorldBossDeath(state: GameState): void {
  const wb = state.worldBoss;
  if (!wb || !wb.active || !wb.entity) return;
  if (wb.entity.hp <= 0) retireWorldBoss(state, wb, true);
}
