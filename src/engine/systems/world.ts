/**
 * World & Town (M6 "World & Town", ROADMAP task 1) — the zone/navigation layer.
 *
 * The game world is a set of ordered MAPS (themes), each a left-to-right run of
 * walkable ZONES. This REGROUPS the existing per-stage content instead of
 * rebuilding it: each FARM zone is one stage's wave content (enemy roster/scaling
 * still driven by `state.stage` = the zone's stage), so combat balance INSIDE a
 * zone is unchanged. A map is [ (town, only map1) farm×N, boss-room ]. The town is
 * the safe hub + respawn point at the left edge of `CONFIG.world.townMapId`.
 *
 * Progression (see the config `world` note):
 *  - a FARM zone unlocks the NEXT zone once its kill quota (`killGoal(stage)`) is
 *    met (`checkZoneUnlock`). Clearing a farm zone grants the SAME xp/gold the old
 *    per-stage boss did (`xpPerBossKill`/`goldPerBoss`, reused — so the leveling
 *    curve is preserved without a per-zone boss). Unlocking the BOSS ROOM grants
 *    nothing here (the boss room provides its own reward).
 *  - the BOSS ROOM unlocks after the last farm zone; beating it unlocks the next
 *    MAP's first zone (`onBossRoomCleared`, called from boss.onBossKilled).
 *  - death -> respawn in TOWN (`respawnToTown`), then (toggle-gated) auto-walk back
 *    to the last farmed zone (`arriveAtZone` town branch). Never stalls.
 *
 * PURITY / DETERMINISM: no RNG (the seeded stream stays wave-composition only), no
 * wall-clock. Transit is a fixed-dt timer. This module imports NO other combat
 * system that imports it back (it spawns no boss — step() calls startBossFight on a
 * boss-room arrival — so `boss`/`combat` may import world without a cycle).
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { grantKillXp } from "@/engine/systems/leveling";
import { creditGold } from "@/engine/systems/economy";
import { heroMaxHpOf, heroMaxManaOf } from "@/engine/systems/stats";
import { tier3QuestId, isTier3BossObjectiveActive } from "@/engine/systems/quests";
import type { WorldLocation, ZoneKind } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** A resolved zone: its map/index plus its derived kind + content stage. */
export interface Zone {
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  /** Content stage (drives enemy/boss scaling). Town reuses the first farm stage. */
  stage: number;
}

/**
 * Reason a transit / arrival happened — town arrival auto-returns to farming after
 * a "death" (respawn) or a "scroll" (return-scroll teleport); a plain "walk" stays
 * put. "bot" is an idle-bot town trip (M7.5 — handled by systems/bots on arrival,
 * NOT the generic auto-return branch); "fasttravel" is the instant free hop (M7.5,
 * arrives directly via `arriveAtZone`, never through a transit). Only a "walk" emits
 * the zone-gate archway events. Kept a small closed union so each branch reads clearly.
 */
export type TravelReason = "walk" | "death" | "scroll" | "bot" | "fasttravel";

/** In-flight walk between zones (transient; never persisted). */
export interface TravelState {
  targetMapId: string;
  targetZoneIdx: number;
  /** Seconds of transit remaining (counts down at FIXED_DT). */
  timer: number;
  reason: TravelReason;
  /** Zone-gate polish (M7.5, WALK transits only): the arrival-edge gate side + x so
   * `updateTransit` can emit `zoneGateExit` on arrival. Unset for non-walk transits. */
  exitSide?: "left" | "right";
  exitGateX?: number;
}

// ---------------------------------------------------------------------------
// Static world layout (built once from CONFIG.world — config-driven).
// ---------------------------------------------------------------------------

function buildZones(): Zone[] {
  const zones: Zone[] = [];
  for (const m of CONFIG.world.maps) {
    let idx = 0;
    if (m.id === CONFIG.world.townMapId) {
      zones.push({ mapId: m.id, zoneIdx: idx++, kind: "town", stage: m.zoneStageIds[0] });
    }
    for (const stage of m.zoneStageIds) {
      zones.push({ mapId: m.id, zoneIdx: idx++, kind: "farm", stage });
    }
    zones.push({ mapId: m.id, zoneIdx: idx++, kind: "boss", stage: m.bossStageId });
  }
  return zones;
}

/** The flat, globally-ordered zone list (town, map1 farms, map1 boss, map2 …). */
export const WORLD_ZONES: readonly Zone[] = buildZones();

const FIRST_FARM: Zone =
  WORLD_ZONES.find((z) => z.kind === "farm") ?? WORLD_ZONES[0];
const TOWN: Zone | null = WORLD_ZONES.find((z) => z.kind === "town") ?? null;

// ---------------------------------------------------------------------------
// Lookups (pure).
// ---------------------------------------------------------------------------

/** Global index of a location in `WORLD_ZONES`, or -1 if unknown. */
export function globalIndex(loc: WorldLocation): number {
  return WORLD_ZONES.findIndex((z) => z.mapId === loc.mapId && z.zoneIdx === loc.zoneIdx);
}

/** Resolve a location to its `Zone` (defensive: falls back to the first farm). */
export function zoneAt(loc: WorldLocation): Zone {
  return WORLD_ZONES.find((z) => z.mapId === loc.mapId && z.zoneIdx === loc.zoneIdx) ?? FIRST_FARM;
}

/** The fresh-start location: the first farm zone (map1, stage 1). */
export function firstFarmLocation(): WorldLocation {
  return { mapId: FIRST_FARM.mapId, zoneIdx: FIRST_FARM.zoneIdx };
}

/** The town location (respawn hub), or null if no map hosts a town. */
export function townLocation(): WorldLocation | null {
  return TOWN ? { mapId: TOWN.mapId, zoneIdx: TOWN.zoneIdx } : null;
}

/** Number of zones in a map (0 for an unknown map id). */
export function mapZoneCount(mapId: string): number {
  return WORLD_ZONES.reduce((n, z) => (z.mapId === mapId ? n + 1 : n), 0);
}

/** Whether a location addresses a real zone. */
export function isValidLocation(loc: WorldLocation): boolean {
  return globalIndex(loc) >= 0;
}

/** A zone's walkable width in engine units (per-map `fieldWidth`, default 900). */
function fieldWidthOf(mapId: string): number {
  return CONFIG.world.maps.find((m) => m.id === mapId)?.fieldWidth ?? 900;
}

/** The x of a zone's left/right edge GATE (M7.5 gate transit + fast-travel arrival). */
export function gateX(mapId: string, side: "left" | "right"): number {
  return side === "left"
    ? CONFIG.hunt.heroMinX
    : fieldWidthOf(mapId) - CONFIG.hunt.fieldRightMargin;
}

/** The farm zone whose content stage is `stage`, clamped into the frontier. */
export function farmLocationForStage(stage: number): WorldLocation {
  const exact = WORLD_ZONES.find((z) => z.kind === "farm" && z.stage === stage);
  if (exact) return { mapId: exact.mapId, zoneIdx: exact.zoneIdx };
  const farms = WORLD_ZONES.filter((z) => z.kind === "farm");
  const target = stage < farms[0].stage ? farms[0] : farms[farms.length - 1];
  return { mapId: target.mapId, zoneIdx: target.zoneIdx };
}

// ---------------------------------------------------------------------------
// Unlock bookkeeping. `unlockedZones[mapId]` = count of unlocked zones in that
// map; a zone is unlocked iff `zoneIdx < count`.
// ---------------------------------------------------------------------------

/** Persisted (real) unlock: a zone is normally unlocked iff its idx is below the
 * map's saved unlocked count. This is the ONLY unlock that cascades / persists —
 * the quest preview grant below is deliberately kept OUT of it (see `checkZoneUnlock`). */
function isZonePersistUnlocked(state: GameState, loc: WorldLocation): boolean {
  return loc.zoneIdx < (state.unlockedZones[loc.mapId] ?? 0);
}

// ---------------------------------------------------------------------------
// Tier-3 quest PREVIEW access (M7.9 redesign, owner "option ข" 2026-07-08).
// While the solo hero holds the ACCEPTED tier-3 quest, the quest's frontier field —
// map4 zone 1 (s16), the FIRST farm zone of `CONFIG.quest.tier3.killMapId` — becomes
// enterable/travelable even though the s15 boss hasn't unlocked it. This is a DERIVED
// grant (read from `hero.quest` each call), NOT a persisted unlock: dropping the quest
// or evolving (which consumes it) removes the grant, so map4 stays locked unless the
// s15 boss has since done the REAL unlock. ONLY zone 1 is granted — zones 2+ and the
// boss room stay gated behind the s15 boss kill (see the redesign note in config).
// Deterministic (no RNG, no wall-clock).
// ---------------------------------------------------------------------------

/** The single frontier zone the ACTIVE tier-3 quest previews (map4 zone 1, s16), or
 * null if the quest's kill-map has no farm zone. Derived from CONFIG, not hard-coded. */
function tier3PreviewZone(): WorldLocation | null {
  const mapId = CONFIG.quest.tier3.killMapId;
  const z = WORLD_ZONES.find((zn) => zn.mapId === mapId && zn.kind === "farm");
  return z ? { mapId: z.mapId, zoneIdx: z.zoneIdx } : null;
}

/** The map4 BOSS ROOM (the young-Sovereign fight), the tier-3 quest's second-objective
 * arena. Derived from CONFIG's kill-map, not hard-coded. Null if the map has no boss room. */
function tier3BossRoomZone(): WorldLocation | null {
  const mapId = CONFIG.quest.tier3.killMapId;
  const z = WORLD_ZONES.find((zn) => zn.mapId === mapId && zn.kind === "boss");
  return z ? { mapId: z.mapId, zoneIdx: z.zoneIdx } : null;
}

/** Whether the solo hero's ACTIVE tier-3 quest grants derived access to `loc`. Grants:
 *  - map4 ZONE 1 (the frontier field) — whenever the quest is held (both objectives);
 *  - the map4 BOSS ROOM — ONLY once the kill objective is banked (boss objective active),
 *    so the "young Sovereign" arena opens for the second objective.
 * Zones 2-5 are NEVER granted (they stay gated behind the s15 boss). The boss-room grant
 * revokes the instant the boss objective completes / the quest is consumed on evolve. */
export function questGrantsZoneAccess(state: GameState, loc: WorldLocation): boolean {
  const hero = state.heroes[0];
  const q = hero?.quest;
  if (!q || !q.accepted || q.id !== tier3QuestId(hero!.cls)) return false;
  const preview = tier3PreviewZone();
  if (preview && preview.mapId === loc.mapId && preview.zoneIdx === loc.zoneIdx) return true;
  const bossRoom = tier3BossRoomZone();
  if (
    bossRoom &&
    bossRoom.mapId === loc.mapId &&
    bossRoom.zoneIdx === loc.zoneIdx &&
    isTier3BossObjectiveActive(state)
  ) {
    return true;
  }
  return false;
}

/**
 * Zone access = the persisted unlock OR the derived tier-3 quest preview grant. This is
 * the read used for ENTERING a zone (walk arrows, fast travel, auto-return), so the
 * preview zone is travelable while the quest is active. It is NOT used by
 * `checkZoneUnlock` (a preview zone must never cascade a persisted unlock).
 */
export function isZoneUnlocked(state: GameState, loc: WorldLocation): boolean {
  return isZonePersistUnlocked(state, loc) || questGrantsZoneAccess(state, loc);
}

/**
 * The per-map unlocked-zone counts with any ACTIVE tier-3 quest preview grant folded in
 * — a clean extension of the `state.unlockedZones` read path so the UI's zone/fast-travel
 * surface (which reads a plain count map, `ui/world/zones.isZoneUnlockedUi`) sees the
 * granted preview zone WITHOUT reaching into engine internals. Returns a COPY (never
 * mutates `state.unlockedZones`, so the grant is never persisted): the granted map's
 * count is bumped just far enough to include the preview zone. Identity-safe to call
 * every snapshot — with no active quest it equals `{...state.unlockedZones}`.
 *
 * NB (M7.9b): the boss-room grant is deliberately NOT folded in here — a count map can't
 * express "zone 1 + boss room but not zones 2-5" (a count of 6 would wrongly open 2-5).
 * The boss room isn't a zone-list / fast-travel target anyway; its access is the per-loc
 * `questGrantsZoneAccess` boolean (used by the challenge-into-the-boss-room path), so the
 * count map stays precisely "map4 z1 only" and zones 2-5 read locked.
 */
export function effectiveUnlockedZones(state: GameState): Record<string, number> {
  const out: Record<string, number> = { ...state.unlockedZones };
  const hero = state.heroes[0];
  const q = hero?.quest;
  if (q && q.accepted && q.id === tier3QuestId(hero!.cls)) {
    const preview = tier3PreviewZone();
    if (preview) out[preview.mapId] = Math.max(out[preview.mapId] ?? 0, preview.zoneIdx + 1);
  }
  return out;
}

/** Per-map unlocked counts covering every global zone up to (and incl.) `loc`. */
export function unlockUpTo(loc: WorldLocation): Record<string, number> {
  const gi = globalIndex(loc);
  const out: Record<string, number> = {};
  const upto = gi < 0 ? globalIndex(firstFarmLocation()) : gi;
  for (let i = 0; i <= upto; i++) {
    const z = WORLD_ZONES[i];
    out[z.mapId] = Math.max(out[z.mapId] ?? 0, z.zoneIdx + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Navigation reads (for the UI walk controls).
// ---------------------------------------------------------------------------

export interface ZoneNeighbor {
  zone: Zone;
  unlocked: boolean;
}

export interface WorldNav {
  current: Zone;
  /** The adjacent zone one step LEFT (lower stage / town), or null at the edge. */
  left: ZoneNeighbor | null;
  /** The adjacent zone one step RIGHT (next zone / boss room / next map). */
  right: ZoneNeighbor | null;
  /** True while a walk transit is in progress (arrows disabled). */
  traveling: boolean;
}

/** Adjacent-zone availability for the walk arrows (pure read). */
export function worldNav(state: GameState): WorldNav {
  const gi = globalIndex(state.location);
  const current = gi >= 0 ? WORLD_ZONES[gi] : FIRST_FARM;
  const leftZ = gi > 0 ? WORLD_ZONES[gi - 1] : null;
  const rightZ = gi >= 0 && gi + 1 < WORLD_ZONES.length ? WORLD_ZONES[gi + 1] : null;
  return {
    current,
    left: leftZ ? { zone: leftZ, unlocked: isZoneUnlocked(state, leftZ) } : null,
    right: rightZ ? { zone: rightZ, unlocked: isZoneUnlocked(state, rightZ) } : null,
    traveling: state.traveling !== null,
  };
}

// ---------------------------------------------------------------------------
// Battlefield / hero reset shared by every zone arrival.
// ---------------------------------------------------------------------------

/** Full-heal + un-death every hero (a fresh footing when entering a zone). */
function reviveHeroesFull(state: GameState): void {
  for (const h of state.heroes) {
    h.dead = false;
    h.reviveTimer = 0;
    h.maxHp = heroMaxHpOf(h);
    h.hp = h.maxHp;
    h.maxMana = heroMaxManaOf(h);
    h.mana = h.maxMana;
    h.cd = 0;
    h.skillCds = {};
    h.atkBuffMult = 1;
    h.atkBuffTimer = 0;
    // Manual play (M7.8): a zone arrival is a fresh footing — drop any pending
    // move/attack command so a stale tap never carries across a transit / into a
    // boss room (boss forced-combat owns the hero there anyway).
    h.command = null;
  }
}

// ---------------------------------------------------------------------------
// Transit + arrival.
// ---------------------------------------------------------------------------

/** Clear the field and begin a walk to `target` lasting `seconds`. */
export function beginTransit(
  state: GameState,
  target: WorldLocation,
  seconds: number,
  reason: TravelReason,
): void {
  state.enemies = [];
  state.projectiles = [];
  state.boss = null;
  const tr: TravelState = {
    targetMapId: target.mapId,
    targetZoneIdx: target.zoneIdx,
    timer: seconds,
    reason,
  };
  // Zone-gate polish (M7.5): only a WALK transit passes through the themed archway.
  // The hero enters the departure-edge gate now (zoneGateEnter) and will emerge from
  // the arrival-edge gate on arrival (updateTransit -> zoneGateExit). Sides follow
  // the travel direction (walking right = out the right gate, in the left gate).
  if (reason === "walk") {
    const goingRight = globalIndex(target) > globalIndex(state.location);
    const enterSide: "left" | "right" = goingRight ? "right" : "left";
    tr.exitSide = goingRight ? "left" : "right";
    tr.exitGateX = gateX(target.mapId, tr.exitSide);
    state.events.push({ type: "zoneGateEnter", x: gateX(state.location.mapId, enterSide), side: enterSide });
  }
  state.traveling = tr;
}

/**
 * Start walking to an adjacent, unlocked zone. No-op (false) while already
 * traveling, mid boss fight, dead, or if the target isn't unlocked/adjacent.
 */
export function walkToZone(state: GameState, target: WorldLocation): boolean {
  if (state.traveling) return false;
  if (state.phase === "boss") return false;
  const hero = state.heroes[0];
  if (hero?.dead) return false;
  if (!isZoneUnlocked(state, target)) return false;
  const gi = globalIndex(state.location);
  const gt = globalIndex(target);
  if (gi < 0 || gt < 0 || Math.abs(gt - gi) !== 1) return false;
  beginTransit(state, target, CONFIG.world.transitSeconds, "walk");
  return true;
}

/**
 * The map4 boss room to challenge for the tier-3 quest's second objective, IF the solo hero
 * is eligible right now: standing in the granted frontier (map4 z1 preview), with the kill
 * objective banked (boss objective active), not already traveling / in the boss phase / dead.
 * Returns the boss-room location (a DIRECT, non-adjacent walk target — zones 2-5 are never
 * walked through) or null. Deterministic. */
function tier3QuestBossEntry(state: GameState): WorldLocation | null {
  if (state.traveling || state.phase === "boss") return null;
  const hero = state.heroes[0];
  if (!hero || hero.dead) return null;
  if (!isTier3BossObjectiveActive(state)) return null;
  const preview = tier3PreviewZone();
  const bossRoom = tier3BossRoomZone();
  if (!preview || !bossRoom) return null;
  // Challenge only from within the granted frontier field (map4 z1).
  if (state.location.mapId !== preview.mapId || state.location.zoneIdx !== preview.zoneIdx) {
    return null;
  }
  return bossRoom;
}

/**
 * Convenience: walk into the current map's BOSS ROOM (the "เข้าห้องบอส" action),
 * valid when standing at the last farm zone with the boss room unlocked.
 *
 * M7.9b tier-3 quest boss: from the granted map4 frontier, once the kill objective is banked,
 * this same "challenge" action walks the hero DIRECTLY into the map4 boss room (non-adjacent —
 * zones 2-5 stay locked and are never traversed) to fight the quest-scaled young Sovereign.
 * It's a "walk" transit, so step() fires startBossFight on arrival (which picks the quest
 * scales). Guards mirror walkToZone (no double-travel / mid-boss / dead).
 */
export function enterBossRoom(state: GameState): boolean {
  const questBossRoom = tier3QuestBossEntry(state);
  if (questBossRoom) {
    beginTransit(state, questBossRoom, CONFIG.world.transitSeconds, "walk");
    return true;
  }
  const gi = globalIndex(state.location);
  const next = gi >= 0 ? WORLD_ZONES[gi + 1] : undefined;
  if (!next || next.kind !== "boss") return false;
  return walkToZone(state, { mapId: next.mapId, zoneIdx: next.zoneIdx });
}

/** Convenience: from a boss-room victory, walk into the next MAP's first zone. */
export function advanceToNextMap(state: GameState): boolean {
  const gi = globalIndex(state.location);
  const next = gi >= 0 ? WORLD_ZONES[gi + 1] : undefined;
  if (!next || next.mapId === state.location.mapId) return false;
  return walkToZone(state, { mapId: next.mapId, zoneIdx: next.zoneIdx });
}

/**
 * Tick an in-flight transit one fixed step; on arrival applies the zone entry and
 * returns the arrived `Zone` (so step() can spawn the boss for a boss room).
 * Returns null while still traveling.
 */
export function updateTransit(state: GameState): Zone | null {
  const tr = state.traveling;
  if (!tr) return null;
  tr.timer -= FIXED_DT;
  if (tr.timer > 0) return null;
  const target: WorldLocation = { mapId: tr.targetMapId, zoneIdx: tr.targetZoneIdx };
  const reason = tr.reason;
  const exitSide = tr.exitSide;
  const exitGateX = tr.exitGateX;
  state.traveling = null;
  const zone = arriveAtZone(state, target, reason);
  // Zone-gate polish (M7.5): emerge from the arrival-edge gate (WALK transits only).
  if (reason === "walk" && exitSide !== undefined && exitGateX !== undefined) {
    state.events.push({ type: "zoneGateExit", x: exitGateX, side: exitSide });
  }
  return zone;
}

/**
 * Enter `target`: set location + content stage, reset the battlefield, full-heal
 * the hero, and set the phase by zone kind. A boss room does NOT spawn its boss
 * here (step() calls startBossFight after arrival — keeps world free of a boss
 * import). Town arrival after a DEATH auto-returns to the last farm zone (toggle).
 */
export function arriveAtZone(
  state: GameState,
  target: WorldLocation,
  reason: TravelReason,
): Zone {
  const zone = zoneAt(target);
  // Per-zone unlock progress (SAVE v13, the "เกจรี" fix): stash the OLD farm
  // zone's live counter, then restore the NEW zone's stashed progress — a town
  // round trip (bot restock/sell, warp, death respawn) keeps the gauge; only
  // genuinely-new zones start at 0.
  const from = state.location;
  if (zoneAt(from).kind === "farm") {
    state.zoneKills[`${from.mapId}:${from.zoneIdx}`] = state.kills;
  }
  state.location = { mapId: target.mapId, zoneIdx: target.zoneIdx };
  state.stage = zone.stage;
  state.enemies = [];
  state.projectiles = [];
  state.kills =
    zone.kind === "farm" ? (state.zoneKills[`${target.mapId}:${target.zoneIdx}`] ?? 0) : 0;
  state.bossReady = false;
  state.anchorX = CONFIG.baseAnchor;
  // Fresh footing: clear the per-type consumable-use cooldowns (M6) alongside the
  // per-hero skill cooldowns reset in reviveHeroesFull.
  state.consumableCds = {};
  // Hunt-field spawn pool (M6 "สนามล่ามอน"): a farm zone bursts to full on entry;
  // town/boss zones spawn nothing (guarded in updateSpawns).
  state.spawnBurst = zone.kind === "farm";
  state.spawnCd = CONFIG.hunt.initialGap;
  reviveHeroesFull(state);

  state.events.push({
    type: "zoneEntered",
    mapId: zone.mapId,
    zoneIdx: zone.zoneIdx,
    kind: zone.kind,
    stage: zone.stage,
  });

  if (zone.kind === "farm") {
    state.phase = "battle";
    state.lastFarmZone = { mapId: zone.mapId, zoneIdx: zone.zoneIdx };
  } else if (zone.kind === "town") {
    state.phase = "battle";
    // Auto-return after a death respawn OR a return-scroll teleport (never stalls).
    // Toggle-gated for live play ("รอที่เมือง"); the offline replay forces it on so
    // idle never stalls. A plain "walk" into town (manual visit) stays put.
    if ((reason === "death" || reason === "scroll") && state.autoReturn) {
      const back = state.lastFarmZone;
      if (zoneAt(back).kind === "farm" && isZoneUnlocked(state, back)) {
        beginTransit(state, back, CONFIG.world.transitSeconds, "walk");
      }
    }
  } else {
    // Boss room: step() spawns the boss (startBossFight) right after this arrival.
    state.phase = "battle";
    state.events.push({ type: "bossRoomEntered", mapId: zone.mapId, stage: zone.stage });
  }
  return zone;
}

// ---------------------------------------------------------------------------
// Death respawn + progression hooks (called from combat / boss).
// ---------------------------------------------------------------------------

/**
 * Dead hero -> walk back to TOWN and revive there (GDD: death = respawn in town,
 * no penalty). Reuses the old in-place revive delay (`heroReviveTime`) as the
 * walk-home time so the death cost is unchanged; town arrival revives + (toggle)
 * auto-returns to the last farm zone. Replaces the old in-place revive + boss
 * retreat. If no town is configured, does nothing (in-place revive still applies).
 */
export function respawnToTown(state: GameState): void {
  const town = townLocation();
  if (!town) return;
  state.phase = "battle";
  beginTransit(state, town, CONFIG.heroReviveTime, "death");
}

/**
 * Farm-zone quota met -> unlock the NEXT zone (once). Unlocking a FARM zone grants
 * the old per-stage boss reward (xp/gold parity, no per-zone boss); unlocking the
 * BOSS ROOM grants nothing (the boss room pays out itself). Backtracking a cleared
 * zone re-grants nothing (next already unlocked). Called from step after combat.
 */
export function checkZoneUnlock(state: GameState): void {
  if (state.traveling || state.phase !== "battle") return;
  const zone = zoneAt(state.location);
  if (zone.kind !== "farm") return;
  // A tier-3 quest PREVIEW zone (map4 z1, only quest-GRANTED, not persist-unlocked)
  // must NEVER cascade a real unlock to its neighbour — that would permanently open
  // map4 without the s15 boss kill (the redesign's core invariant). Only a
  // persist-unlocked farm zone advances the frontier.
  if (!isZonePersistUnlocked(state, state.location)) return;
  if (state.kills < CONFIG.killGoal(zone.stage)) return;
  const gi = globalIndex(state.location);
  const next = gi >= 0 ? WORLD_ZONES[gi + 1] : undefined;
  if (!next || next.mapId !== zone.mapId) return;
  // Boss-gate arming (2026-07-07 fix, moved here from combat.ts): the challenge
  // affordance lights up ONLY where enterBossRoom can actually work — quota met
  // AT the map's LAST farm zone (the next zone is this map's boss room). The old
  // combat-side check armed on quota alone, so any cleared zone (kills persist
  // per-zone since SAVE v13) showed a glowing button that walked nowhere.
  if (next.kind === "boss" && !state.bossReady) state.bossReady = true;
  if (next.zoneIdx < (state.unlockedZones[next.mapId] ?? 0)) return; // already unlocked

  state.unlockedZones[next.mapId] = next.zoneIdx + 1;
  state.events.push({ type: "zoneUnlocked", mapId: next.mapId, zoneIdx: next.zoneIdx });

  if (next.kind === "farm") {
    creditGold(state, CONFIG.goldPerBoss(zone.stage));
    grantKillXp(state, CONFIG.leveling.xpPerBossKill(zone.stage));
  }
}

/**
 * Auto next-zone (owner request 2026-07-07, UI toggle `state.autoAdvance`):
 * once the CURRENT farm zone's quota is met and the next FARM zone in the same
 * map is unlocked, walk forward automatically. Never auto-enters a boss room
 * (the challenge is a player beat) and never crosses maps (that requires the
 * boss anyway). No-op mid-travel/cast/boss/death or in town.
 */
export function maybeAutoAdvance(state: GameState): void {
  if (!state.autoAdvance) return;
  if (state.traveling || state.fastTravelCast || state.phase !== "battle") return;
  const cur = zoneAt(state.location);
  if (cur.kind !== "farm") return;
  const hero = state.heroes[0];
  if (!hero || hero.dead) return;
  if (state.kills < CONFIG.killGoal(cur.stage)) return;
  const gi = globalIndex(state.location);
  const next = gi >= 0 ? WORLD_ZONES[gi + 1] : undefined;
  if (!next || next.kind !== "farm" || next.mapId !== cur.mapId) return;
  if (next.zoneIdx >= (state.unlockedZones[next.mapId] ?? 0)) return; // locked
  walkToZone(state, { mapId: next.mapId, zoneIdx: next.zoneIdx });
}

/**
 * Boss room cleared -> unlock the next MAP's first zone (progression across the
 * map boundary). Called from boss.onBossKilled (which already flips to victory).
 */
export function onBossRoomCleared(state: GameState): void {
  const zone = zoneAt(state.location);
  if (zone.kind !== "boss") return;
  const gi = globalIndex(state.location);
  const next = gi >= 0 ? WORLD_ZONES[gi + 1] : undefined;
  if (!next || next.mapId === zone.mapId) {
    // Frontier: the last map's boss room is cleared and no further map exists yet
    // (map4 is M7+ content). Signal the graceful "สุดเขตแดนตอนนี้" end-state instead
    // of stalling — the hero stays in the (paused) victory and can walk LEFT to keep
    // farming. Additive event for the UI banner + future render juice.
    state.events.push({ type: "frontierCleared", mapId: zone.mapId });
    return;
  }
  if (next.zoneIdx >= (state.unlockedZones[next.mapId] ?? 0)) {
    state.unlockedZones[next.mapId] = next.zoneIdx + 1;
    state.events.push({ type: "mapUnlocked", mapId: next.mapId });
    state.events.push({ type: "zoneUnlocked", mapId: next.mapId, zoneIdx: next.zoneIdx });
  }
}

// ---------------------------------------------------------------------------
// Fast travel (M7.5 "Fast travel") — a short damage-cancellable channel then an
// instant, FREE hop to any UNLOCKED (non-boss) zone. The return scroll keeps its
// value: it warps INSTANTLY even while swarmed, whereas fast travel demands a clear
// standoff (no engaged/aggro mob) and can be interrupted by damage. Deterministic
// (no RNG, no wall-clock) — the channel is a fixed-dt timer.
// ---------------------------------------------------------------------------

/** Reasons a fast-travel intent is rejected (mirrors the `fastTravelBlocked` event). */
type FastTravelBlockedReason =
  | "locked"
  | "aggro"
  | "dead"
  | "same"
  | "traveling"
  | "boss"
  | "invalid"
  | "damaged";

/** Whether any mob is currently a threat to the hero (engaged, or an aggressive mob
 * inside its aggro radius) — the fast-travel standoff guard. */
function heroUnderThreat(state: GameState): boolean {
  const h = state.heroes[0];
  if (!h) return false;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (e.engaged) return true;
    if (e.aggressive && Math.abs(e.x - h.x) <= e.aggroRadius) return true;
  }
  return false;
}

/**
 * Begin a fast-travel channel to `target`. Rejected (emits `fastTravelBlocked` with
 * a reason, returns false) if a channel is already running, the hero is dead / mid
 * transit / in the boss phase, the target is invalid / a boss room / locked /
 * already-current, or a mob is engaging the hero. On success emits
 * `fastTravelCastStart` and sets the channel; completion happens in `tickFastTravel`.
 */
export function startFastTravel(state: GameState, target: WorldLocation): boolean {
  if (state.fastTravelCast) return false; // already channeling — ignore the re-tap
  const h = state.heroes[0];
  const blocked = (reason: FastTravelBlockedReason): boolean => {
    state.events.push({ type: "fastTravelBlocked", reason });
    return false;
  };
  if (!h || h.dead) return blocked("dead");
  if (state.traveling) return blocked("traveling");
  if (state.phase === "boss") return blocked("boss");
  if (!isValidLocation(target)) return blocked("invalid");
  const zone = zoneAt(target);
  if (zone.kind === "boss") return blocked("invalid"); // boss rooms are entered via the gate, not warped into
  if (!isZoneUnlocked(state, target)) return blocked("locked");
  if (target.mapId === state.location.mapId && target.zoneIdx === state.location.zoneIdx) {
    return blocked("same");
  }
  if (heroUnderThreat(state)) return blocked("aggro");
  state.fastTravelCast = {
    targetMapId: target.mapId,
    targetZoneIdx: target.zoneIdx,
    timer: CONFIG.travel.fastTravelCastSeconds,
    lastHp: h.hp,
  };
  state.events.push({
    type: "fastTravelCastStart",
    x: h.x,
    y: h.y,
    mapId: target.mapId,
    zoneIdx: target.zoneIdx,
  });
  return true;
}

/**
 * Tick an in-flight fast-travel channel one fixed step. Cancels (emits
 * `fastTravelBlocked` "damaged") if the hero took damage since the last tick; on
 * completion performs the instant hop (arrives at the target's LEFT gate x — the
 * entrance side) and emits `fastTravelArrive`. A no-op with no channel. Called from
 * step() after combat so this step's damage is already reflected in the hero's HP.
 */
export function tickFastTravel(state: GameState): void {
  const c = state.fastTravelCast;
  if (!c) return;
  const h = state.heroes[0];
  if (!h || h.dead) {
    state.fastTravelCast = null;
    state.events.push({ type: "fastTravelBlocked", reason: "dead" });
    return;
  }
  if (h.hp < c.lastHp) {
    state.fastTravelCast = null;
    state.events.push({ type: "fastTravelBlocked", reason: "damaged" });
    return;
  }
  c.lastHp = h.hp; // allow healing during the channel without spuriously cancelling
  c.timer -= FIXED_DT;
  if (c.timer > 0) return;

  const target: WorldLocation = { mapId: c.targetMapId, zoneIdx: c.targetZoneIdx };
  state.fastTravelCast = null;
  state.traveling = null;
  arriveAtZone(state, target, "fasttravel");
  const arriveX = gateX(target.mapId, "left");
  h.x = arriveX;
  state.events.push({
    type: "fastTravelArrive",
    x: arriveX,
    y: h.y,
    mapId: target.mapId,
    zoneIdx: target.zoneIdx,
  });
}
