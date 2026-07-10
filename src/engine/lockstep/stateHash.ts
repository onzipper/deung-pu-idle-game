/**
 * M8 party P3 — deterministic state hash (the lockstep desync CANARY, design §7).
 *
 * A cheap 32-bit rolling hash (FNV-1a over EXPLICIT, ordered field serialization)
 * of the sim-relevant slice of a `GameState`. Every client attaches the hash of the
 * turn it just executed to its next `TurnInput`; peers compare same-tick hashes. In a
 * pure/deterministic engine a mismatch is a BUG, never a normal event — this is the
 * safety net that turns a determinism regression into a loud red test instead of a
 * silent cross-client divergence.
 *
 * WHY a hand-rolled hash (not `JSON.stringify`):
 *  - `JSON.stringify` over objects has NO guaranteed key order across shapes and
 *    silently drops `undefined`/`NaN` — a determinism hash must be byte-exact and
 *    ORDER-STABLE, so every field is folded in a fixed sequence here.
 *  - Numbers are hashed at FULL IEEE-754 precision (both 32-bit words of the double),
 *    NOT quantized. A 1-ULP divergence in any hashed float changes the hash — that is
 *    what lets the divergence-canary test prove the hash "isn't blind". (The on-wire
 *    hash in a future client MAY quantize positions to shave bytes; this harness hash
 *    is deliberately exact so headless tests catch the smallest drift.)
 *
 * ── INCLUDED (sim-relevant shared state) ──────────────────────────────────────────
 *   time · rngState · nextId · stage · phase · kills · bossReady · anchorX
 *   spawnCd/spawnBurst/spawnPaused · location(mapId,zoneIdx)
 *   gold · goldEarned · materials · lootSalt · lootCounter
 *   traveling · fastTravelCast · autoHunt (the one global toggle a lane mutates)
 *   consumables (counts) · consumableCds (sorted)
 *   PER HERO (slot order): id/cls/x/y/planeY/hp/maxHp/cd/dead/reviveTimer/mana/maxMana/
 *     atkBuff(mult,timer)/level/xp/tier/statPoints/stats(str,dex,int,vit)/skillCds/
 *     autoSlots/equipped(weapon,armor,refine)/command/planeYHold(present-only)/config(all 7 fields)/shadowed
 *   enemies (array order): id/kind/hp/maxHp/x/y/planeY/atk/speed/size/behavior/range/cd/
 *     engageOffset/homeX/aggressive/aggroRadius/engaged
 *   boss (+variety mechanic timers) · projectiles (array order, all fields)
 *
 * ── EXCLUDED (transients / render observers — NOT part of the shared sim) ──────────
 *   state.events (per-step render/audio buffer, cleared each step)
 *   hero.aimX (render-only FACING observer, re-derived each step, never read by sim)
 *   hero.evadeCd/evadeHpMark/evadeMarkCd (NINJA dash-evade counters) — a PURE deterministic
 *     function of already-hashed shared state (hp / enemy positions / fixed dt), so they evolve
 *     identically on every client; the observable they steer (hero.x) IS hashed, so divergence is
 *     still caught. Excluding them keeps the 3-class canonical hash byte-identical (like aimX).
 *   The UI-mirrored global toggles that no lane mutates in a cohort (autoCast/
 *     autoAllocate/autoReturn/autoAdvance/auto-potion globals + thresholds): a cohort
 *     drives config PER HERO via `setHeroConfig`, and those globals never change once
 *     `initGameState` seeds them (heroes.length>1 skips the solo store-mirror), so they
 *     are constant across clients and add nothing to divergence detection. `autoHunt`
 *     IS included (lane-0 `setAutoHunt` mutates it).
 *   bot trip transients (botPending/botWalk/botDwell/sellTripWatermark): the idle bot
 *     is OFF by default in a cohort; if ever driven it is deterministic off lane 0, but
 *     it is automation scaffolding, not battlefield state, so it is left out to keep the
 *     hash lean. (Add it here if a future cohort ever runs the bot.)
 */

import type { GameState } from "@/engine/state";
import type { Hero, Enemy, Boss, Projectile } from "@/engine/entities";

// Reused typed-array view: reinterpret a float64 as its two uint32 words so the hash
// is sensitive to every mantissa bit (1-ULP divergence detection). Module-scoped and
// reused (allocation-free) — the hash is called every turn on every client.
const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

const FNV_PRIME = 0x01000193;
/** FNV-1a 32-bit offset basis — the hash seed. */
export const HASH_SEED = 0x811c9dc5;

/** Fold one 32-bit word into the running hash (FNV-1a). */
function mix(h: number, word: number): number {
  return Math.imul(h ^ (word >>> 0), FNV_PRIME) >>> 0;
}

/** Fold a JS number at full double precision (both 32-bit words). */
function num(h: number, n: number): number {
  _f64[0] = n;
  return mix(mix(h, _u32[0]), _u32[1]);
}

/** Fold a boolean with two distinct sentinels (so false ≠ absent). */
function bool(h: number, b: boolean): number {
  return mix(h, b ? 0x2f2f2f2f : 0x15151515);
}

/** Fold a string (length-prefixed so "a"+"bc" ≠ "ab"+"c"). */
function str(h: number, s: string): number {
  h = mix(h, s.length);
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}

/** Fold a nullable string. */
function optStr(h: number, s: string | null): number {
  return s === null ? mix(h, 0x6e756c6c /* "null" */) : str(h, s);
}

/** Fold a numeric record in SORTED-KEY order (Object key order is not guaranteed
 *  identical across insertion histories, so it must be canonicalised here). */
function record(h: number, rec: Record<string, number | undefined>): number {
  const keys = Object.keys(rec).sort();
  // Skip undefined/≤0-absent entries so a "ready" (missing) cooldown and a 0 cooldown
  // hash identically — matches how the sim treats them (a missing/≤0 entry = ready).
  const live = keys.filter((k) => {
    const v = rec[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  });
  h = mix(h, live.length);
  for (const k of live) h = num(str(h, k), rec[k] as number);
  return h;
}

function hashHero(h: number, hero: Hero): number {
  h = num(h, hero.id);
  h = str(h, hero.cls);
  h = num(h, hero.x);
  h = num(h, hero.y);
  // R4 Wave A depth-plane y (engine-owned deterministic y at spawn) — sim-relevant NEW state,
  // folded present-only so a state WITHOUT it (hand-built literals) hashes byte-identically to
  // pre-feature. Every factory-built hero HAS it; it is a pure fn of already-hashed state (id /
  // slot / partySize), so lockstep clients always agree — folding it just makes the canary also
  // catch a plane-math divergence.
  if (typeof hero.planeY === "number") h = num(h, hero.planeY);
  h = num(h, hero.hp);
  h = num(h, hero.maxHp);
  h = num(h, hero.cd);
  h = bool(h, hero.dead);
  h = num(h, hero.reviveTimer);
  h = num(h, hero.mana);
  h = num(h, hero.maxMana);
  h = num(h, hero.atkBuffMult);
  h = num(h, hero.atkBuffTimer);
  h = num(h, hero.level);
  h = num(h, hero.xp);
  h = num(h, hero.tier);
  h = num(h, hero.statPoints);
  h = num(h, hero.stats.str);
  h = num(h, hero.stats.dex);
  h = num(h, hero.stats.int);
  h = num(h, hero.stats.vit);
  h = record(h, hero.skillCds);
  h = mix(h, hero.autoSlots.length);
  for (const s of hero.autoSlots) h = optStr(h, s);
  h = optStr(h, hero.equipped.weapon);
  h = optStr(h, hero.equipped.armor);
  h = num(h, hero.equipped.refine?.weapon ?? 0);
  h = num(h, hero.equipped.refine?.armor ?? 0);
  // Manual command (transient combat steering — sim-relevant: it drives the feet).
  if (hero.command === null) {
    h = mix(h, 0x636d6400 /* "cmd\0" = none */);
  } else if (hero.command.kind === "move") {
    h = num(str(h, "move"), hero.command.x);
  } else {
    h = num(str(h, "attack"), hero.command.targetId);
  }
  // R4.5 Wave 1.1 depth-row HOLD — a transient latch that shapes FUTURE `planeY` trajectories
  // (idle steering targets `planeYHold ?? home`), so it folds in as a cheap desync canary. Present-
  // only: a state that never latched a hold (x-only moves, every pre-Wave-1.1 run) hashes byte-
  // identically to before. Every client latches it from the same arrived command, so they agree.
  if (typeof hero.planeYHold === "number") h = num(h, hero.planeYHold);
  // Per-hero automation config (replicated shared state).
  const c = hero.config;
  h = bool(h, c.autoCast);
  h = bool(h, c.autoAllocate);
  h = bool(h, c.autoHunt);
  h = bool(h, c.autoHpPotion);
  h = bool(h, c.autoManaPotion);
  h = num(h, c.autoHpThreshold);
  h = num(h, c.autoManaThreshold);
  // config.{enabled,sellTripEnabled,hpPotionTarget,mpPotionTarget,scrollReserve,goldReserve}
  // (the per-hero idle-bot settings, 2026-07-09) are EXCLUDED — same as the legacy shared
  // `state.bot` always was (automation scaffolding, not battlefield state). The bot's OBSERVABLE
  // effects (town trips, gold/consumable spends) all land on already-hashed fields, so divergence
  // is still caught; excluding these keeps the canonical / determinism hashes byte-identical.
  // Shadow-body flag (M8 P2) — sim-relevant LANE POLICY (a shadowed hero's manual/lead
  // intents are dropped in `step()`), replicated shared state, so it MUST fold in.
  h = bool(h, hero.shadowed);
  // hero.aimX EXCLUDED — render-only facing observer, never read by the sim.
  return h;
}

function hashEnemy(h: number, e: Enemy): number {
  h = num(h, e.id);
  h = str(h, e.kind);
  h = num(h, e.hp);
  h = num(h, e.maxHp);
  h = num(h, e.x);
  h = num(h, e.y);
  // R4 Wave A depth-plane y (present-only, see hashHero) — every spawned mob has it.
  if (typeof e.planeY === "number") h = num(h, e.planeY);
  h = num(h, e.atk);
  h = num(h, e.speed);
  h = num(h, e.size);
  h = str(h, e.behavior);
  h = num(h, e.range);
  h = num(h, e.cd);
  h = num(h, e.engageOffset);
  h = num(h, e.homeX);
  h = bool(h, e.aggressive);
  h = num(h, e.aggroRadius);
  h = bool(h, e.engaged);
  // ดินแดนอสูร ELITE flag (endgame v1) — sim-relevant (drives kill xp/gold/stone bursts +
  // essence). Folded ONLY when true (present-only) so an ordinary mob hashes byte-identically
  // to pre-endgame (the canonical / determinism suites stay green — no per-enemy bool always folded).
  if (e.elite) h = mix(h, 0x656c6974 /* "elit" */);
  return h;
}

function hashBoss(h: number, b: Boss): number {
  h = num(h, b.id);
  h = num(h, b.x);
  h = num(h, b.y);
  // R4 Wave A depth-plane y (present-only, see hashHero) — makeBoss/makeWorldBoss set it.
  if (typeof b.planeY === "number") h = num(h, b.planeY);
  h = num(h, b.hp);
  h = num(h, b.maxHp);
  h = num(h, b.atk);
  h = num(h, b.cd);
  h = num(h, b.skillCd);
  h = num(h, b.telegraph);
  h = bool(h, b.enraged);
  const v = b.variety;
  if (v) {
    h = mix(h, v.behaviors.length);
    for (const beh of v.behaviors) h = str(h, beh);
    h = num(h, v.chargeCd);
    h = str(h, v.chargePhase);
    h = num(h, v.chargeTimer);
    h = num(h, v.chargeTargetX);
    h = num(h, v.summonsFired);
    h = num(h, v.hazardCd);
    h = str(h, v.hazardPhase);
    h = num(h, v.hazardTimer);
    h = num(h, v.hazardTickTimer);
    h = num(h, v.hazardTicksLeft);
  } else {
    h = mix(h, 0x6e6f7662 /* "novb" = no variety */);
  }
  return h;
}

function hashProjectile(h: number, p: Projectile): number {
  h = num(h, p.id);
  h = str(h, p.kind);
  h = str(h, p.team);
  h = num(h, p.x);
  h = num(h, p.y);
  h = num(h, p.damage);
  h = num(h, p.speed);
  h = num(h, p.targetId ?? -1);
  h = num(h, p.tx);
  h = num(h, p.ty);
  h = num(h, p.aoe);
  return h;
}

/**
 * Deterministic 32-bit hash of the sim-relevant slice of `state` (see the module
 * header for the exact INCLUDED / EXCLUDED field list). Pure read — never mutates
 * `state`. Same state ⇒ same hash on every JS engine (integer FNV-1a + IEEE-754 bit
 * folding only; no transcendental / locale / Object-order dependence).
 */
export function stateHash(state: GameState): number {
  let h = HASH_SEED;

  // --- shared scalars ---
  h = num(h, state.time);
  h = mix(h, state.rngState);
  h = num(h, state.nextId);
  h = num(h, state.stage);
  h = str(h, state.phase);
  h = num(h, state.kills);
  h = bool(h, state.bossReady);
  h = num(h, state.anchorX);
  h = num(h, state.spawnCd);
  h = bool(h, state.spawnBurst);
  h = bool(h, state.spawnPaused);
  h = str(h, state.location.mapId);
  h = num(h, state.location.zoneIdx);

  // --- economy (shared / lead-lane) ---
  h = num(h, state.gold);
  h = num(h, state.goldEarned);
  h = num(h, state.materials);
  h = mix(h, state.lootSalt);
  h = num(h, state.lootCounter);
  h = bool(h, state.autoHunt);

  // --- consumables ---
  h = num(h, state.consumables.hpPotion);
  h = num(h, state.consumables.manaPotion);
  h = num(h, state.consumables.returnScroll);
  h = record(h, state.consumableCds as Record<string, number | undefined>);

  // --- transit / channel ---
  if (state.traveling) {
    h = mix(h, 0x7472766c /* "trvl" */);
    h = str(h, state.traveling.targetMapId);
    h = num(h, state.traveling.targetZoneIdx);
    h = num(h, state.traveling.timer);
    h = str(h, state.traveling.reason);
  } else {
    h = mix(h, 0x6e6f7472 /* "notr" */);
  }
  if (state.fastTravelCast) {
    h = str(h, state.fastTravelCast.targetMapId);
    h = num(h, state.fastTravelCast.targetZoneIdx);
    h = num(h, state.fastTravelCast.timer);
  } else {
    h = mix(h, 0x6e6f6674 /* "noft" */);
  }

  // --- entities (array order is deterministic; fold length first) ---
  h = mix(h, state.heroes.length);
  for (const hero of state.heroes) h = hashHero(h, hero);
  h = mix(h, state.enemies.length);
  for (const e of state.enemies) h = hashEnemy(h, e);
  if (state.boss) {
    h = mix(h, 0x626f7373 /* "boss" */);
    h = hashBoss(h, state.boss);
  } else {
    h = mix(h, 0x6e6f6273 /* "nobs" */);
  }
  h = mix(h, state.projectiles.length);
  for (const p of state.projectiles) h = hashProjectile(h, p);

  // --- WORLD BOSS "เสี่ยจ๋อง" (transient hourly boss). Sim-affecting (targeting +
  // damage), so it MUST fold in — but ONLY when present, so a DORMANT state (no world
  // boss ever spawned) hashes byte-identically to pre-feature (the solo canonical /
  // determinism suites stay green). The record persists after a despawn/defeat (entity
  // nulled) — that too is sim-relevant (it blocks a same-window respawn) so it folds.
  // `wb.damageDealt` is EXCLUDED (like the ninja evade counters): a pure deterministic function
  // of the already-hashed damage sequence (identical on every client), a client→server readout
  // observer that never steers the sim. ---
  const wb = state.worldBoss;
  if (wb) {
    h = mix(h, 0x77626f73 /* "wbos" */);
    h = num(h, wb.windowId);
    h = str(h, wb.mapId);
    h = num(h, wb.zoneIdx);
    h = bool(h, wb.active);
    h = bool(h, wb.defeated);
    h = num(h, wb.countdown);
    if (wb.entity) {
      h = mix(h, 0x77626531 /* "wbe1" = entity present */);
      h = hashBoss(h, wb.entity);
    } else {
      h = mix(h, 0x77626530 /* "wbe0" = entity retired */);
    }
  }

  // --- ดินแดนอสูร (ASURA) endgame v1 accrual + schedule state. Sim-affecting (essence/counters
  // are write observers that reload identically; the hot-zone mult + elite tally DRIVE xp/gold/
  // spawns), but folded ONLY when NON-DEFAULT (present-only) so a state that never touched asura
  // (every s1-30 run, the canonical/determinism suites) hashes byte-identically to pre-endgame. ---
  if (state.asuraHotZone !== null) {
    h = mix(h, 0x6168747a /* "ahtz" */);
    h = num(h, state.asuraHotZone);
  }
  if (state.asuraSpawnTally > 0) {
    h = mix(h, 0x61737470 /* "astp" */);
    h = num(h, state.asuraSpawnTally);
  }
  if (state.asuraEssence > 0) {
    h = mix(h, 0x61657373 /* "aess" */);
    h = num(h, state.asuraEssence);
  }
  {
    const keys = Object.keys(state.asuraZoneKills).sort();
    if (keys.length > 0) {
      h = mix(h, 0x617a6b73 /* "azks" */);
      h = mix(h, keys.length);
      for (const k of keys) h = num(str(h, k), state.asuraZoneKills[k]);
    }
  }

  return h >>> 0;
}
