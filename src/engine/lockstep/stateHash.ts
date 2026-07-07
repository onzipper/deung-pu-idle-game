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
 *   PER HERO (slot order): id/cls/x/y/hp/maxHp/cd/dead/reviveTimer/mana/maxMana/
 *     atkBuff(mult,timer)/level/xp/tier/statPoints/stats(str,dex,int,vit)/skillCds/
 *     autoSlots/equipped(weapon,armor,refine)/command/config(all 7 fields)
 *   enemies (array order): id/kind/hp/maxHp/x/y/atk/speed/size/behavior/range/cd/
 *     engageOffset/homeX/aggressive/aggroRadius/engaged
 *   boss (+variety mechanic timers) · projectiles (array order, all fields)
 *
 * ── EXCLUDED (transients / render observers — NOT part of the shared sim) ──────────
 *   state.events (per-step render/audio buffer, cleared each step)
 *   hero.aimX (render-only FACING observer, re-derived each step, never read by sim)
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
  // Per-hero automation config (replicated shared state).
  const c = hero.config;
  h = bool(h, c.autoCast);
  h = bool(h, c.autoAllocate);
  h = bool(h, c.autoHunt);
  h = bool(h, c.autoHpPotion);
  h = bool(h, c.autoManaPotion);
  h = num(h, c.autoHpThreshold);
  h = num(h, c.autoManaThreshold);
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
  return h;
}

function hashBoss(h: number, b: Boss): number {
  h = num(h, b.id);
  h = num(h, b.x);
  h = num(h, b.y);
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

  return h >>> 0;
}
