/**
 * Balance-simulation harness (headless) — M6 WORLD rebaseline tool.
 *
 * M6 "World & Town" regrouped the per-stage content into MAPS of walkable ZONES
 * (farm zones + a boss room). Progression is now WALKING the world: farm a zone to
 * its kill quota (which unlocks the next zone + grants the old per-stage boss
 * reward), walk forward, and enter the map's boss room; beating it unlocks the next
 * map. Combat inside a zone is unchanged (driven by the zone's stage), so this
 * harness runs the pure engine with an idle-player WORLD autopilot per base class
 * and reports per-zone (stage-keyed) time-to-clear so pacing (~unchanged, no new
 * walls, negligible transit) can be verified.
 *
 * Autopilot: auto-cast + auto-allocate + auto-return ON; accept the class-change
 * quest when offered; evolve when it completes; fill auto-slots as skills unlock;
 * walk forward on unlock; enter the boss room; advance to the next map on a
 * boss-room victory. Death -> town -> auto-return is engine behaviour.
 *
 * Run with: `pnpm sim`
 * Knobs (env): SIM_SECONDS, SEEDS, CLASSES (see below).
 */

import {
  CONFIG,
  initGameState,
  step,
  canEvolveHero,
  isEvolutionQuestOffered,
  makeHero,
  tier3QuestId,
  tier3FrontierLocked,
  learnedSkills,
  unlockedAutoSlotCount,
  worldNav,
  zoneAt,
  WORLD_BOSS,
  worldBossLocationFor,
  SIGNATURE_SKILL,
  ITEM_TEMPLATES,
  REFINE,
  refineCost,
  successChanceForLevel,
  failModeForLevel,
  salvageYield,
  SAVE_VERSION,
  FIXED_DT,
  type FrameInput,
  type Hero,
  type GameState,
  type HeroClass,
  type SaveData,
  type ItemTemplate,
  type GearSlot,
  type WorldLocation,
} from "@/engine";

const SIM_SECONDS = Number(process.env.SIM_SECONDS ?? 1800);
const STEPS = Math.round(SIM_SECONDS / FIXED_DT);
const SEEDS = (process.env.SEEDS ?? "1,2,3,42,1337")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const CLASSES: HeroClass[] = (process.env.CLASSES ?? "swordsman,archer,mage")
  .split(",")
  .map((s) => s.trim())
  .filter(
    (s): s is HeroClass =>
      s === "swordsman" || s === "archer" || s === "mage" || s === "ninja",
  );
// GEAR=1 → the autopilot auto-equips the best-for-class drop it sees (M7 drop-
// equilibrium run). Default (unset) → drops are ignored (NO-GEAR run: must match
// the balance-m6 tables, since unarmored combat is byte-identical to pre-M7).
const GEAR = process.env.GEAR === "1";
// REFINE=1 → the autopilot also plays the SERVER's refine role (M7.6 ตีบวก): it
// salvages non-upgrade drops on town trips (materials), then GREEDILY refines the
// equipped gear when materials + surplus gold cover the next +1, and feeds the
// resulting +N into combat via the equip intent's `refineLevel`. Requires GEAR
// (nothing to refine bare). All gold/material bookkeeping is HARNESS-SIDE and the
// refine roll uses a harness splitmix stream (NEVER the engine wave RNG). With
// REFINE unset the code path is inert → byte-identical to the GEAR baseline.
const REFINE_ON = process.env.REFINE === "1" && GEAR;
// REFINE_SWEEP=1 → run the one-factor-at-a-time param grid (below) and print a
// compact comparison table instead of the per-class report.
const REFINE_SWEEP = process.env.REFINE === "sweep" && GEAR;
// The per-seed refine emulation runs for BOTH a single REFINE=1 run and each combo
// of a REFINE=sweep run.
const REFINE_ACTIVE = REFINE_ON || REFINE_SWEEP;
// REFINE_STRESS_SEC (default 0 = off): also grant a refine opportunity every N sec
// of in-farm time, ON TOP of death-town trips — models a player running the M7.5
// restock/sell bots (regular town cadence). Maximises refine progress to STRESS the
// s15 wall against an aggressively-refining player (the sim's death-only cadence
// under-samples refine for tanky classes). Salvage feedstock is still town-gated.
const REFINE_STRESS_SEC = Number(process.env.REFINE_STRESS_SEC ?? 0);

// PARTY=2/3 → run the M8 SAME-ZONE COHORT mode ("Cohort exp pass", docs/balance-m79.md):
// N heroes share one zone's progression on full autopilot, driven by per-hero input lanes
// (step(state, FrameInput[])). Measures per-member xp/hr, kills/hero/min (starvation), deaths
// and boss clear time vs a size-1 baseline run through the SAME cohort runner (so the only
// variable is the headcount). PARTY_MIX=1 forces a representative [sword,archer,mage] trio
// (size 3) instead of N-of-one-class. Unset/1 → the ordinary solo report (engine + harness
// solo paths untouched → canonical sim byte-identical).
const PARTY = Math.max(1, Math.min(3, Math.round(Number(process.env.PARTY ?? 1)) || 1));
const PARTY_MIX = process.env.PARTY_MIX === "1";

// Dev-harness cohort-knob override (PSHARE/PBUFF/PSCALE) — mutate the live CONFIG.party
// curves so a sweep can search values without recompiling the config constants (same
// pattern as applyRefineCombo). Reassigns the derived closures too. Sim-only.
function applyPartyTune(): void {
  const share = process.env.PSHARE === undefined ? undefined : Number(process.env.PSHARE);
  const buff = process.env.PBUFF === undefined ? undefined : Number(process.env.PBUFF);
  const scale = process.env.PSCALE === undefined ? undefined : Number(process.env.PSCALE);
  const resp = process.env.PRESPAWN === undefined ? undefined : Number(process.env.PRESPAWN);
  if (share === undefined && buff === undefined && scale === undefined && resp === undefined) return;
  const P = CONFIG.party as unknown as {
    expShareRate: number; expBuffPerMember: number; spawnScalePerMember: number;
    respawnScalePerMember: number;
    expBuff: (n: number) => number;
    expKillMult: (n: number, a: number) => number;
    spawnMaxAliveScale: (n: number) => number;
    respawnDelayScale: (n: number) => number;
  };
  const r = share ?? P.expShareRate;
  const b = buff ?? P.expBuffPerMember;
  const sc = scale ?? P.spawnScalePerMember;
  const rs = resp ?? P.respawnScalePerMember;
  P.expShareRate = r; P.expBuffPerMember = b; P.spawnScalePerMember = sc;
  P.respawnScalePerMember = rs;
  P.expBuff = (n: number) => (n <= 1 ? 1 : 1 + b * (n - 1));
  P.expKillMult = (n: number, a: number) =>
    n <= 1 ? 1 : P.expBuff(n) * ((1 + (Math.max(1, a) - 1) * r) / Math.max(1, a));
  P.spawnMaxAliveScale = (n: number) => (n <= 1 ? 1 : 1 + sc * (n - 1));
  P.respawnDelayScale = (n: number) => (n <= 1 ? 1 : 1 / (1 + rs * (n - 1)));
}
applyPartyTune();

// ---------------------------------------------------------------------------
// Refine sweep — the tunables under test (M7.6). Each combo mutates the live
// REFINE config so BOTH the harness (roll/cost/salvage) AND the engine
// (refinedStat in combat) read the same values, then the class×seed matrix runs.
// ---------------------------------------------------------------------------

interface RefineCombo {
  label: string;
  /** statBonusPerRefine (combat-facing +N stat multiplier increment). */
  bonus: number;
  /** +8/+9/+10 success band. */
  band: { 8: number; 9: number; 10: number };
  /** gold cost scalar (× the base goldPerTier2Level 5). */
  goldX: number;
}

// Draft center + one-factor-at-a-time excursions (bonus {.06,.08,.10}; the +8-10
// band draft vs harsher; gold cost draft vs ×2).
const DRAFT_BAND = { 8: 0.45, 9: 0.35, 10: 0.25 };
const HARSH_BAND = { 8: 0.35, 9: 0.25, 10: 0.15 };
const REFINE_GRID: RefineCombo[] = [
  { label: "draft(.08/soft/g5)", bonus: 0.08, band: DRAFT_BAND, goldX: 1 },
  { label: "bonus.06", bonus: 0.06, band: DRAFT_BAND, goldX: 1 },
  { label: "bonus.10", bonus: 0.1, band: DRAFT_BAND, goldX: 1 },
  { label: "harshBand", bonus: 0.08, band: HARSH_BAND, goldX: 1 },
  { label: "gold×2", bonus: 0.08, band: DRAFT_BAND, goldX: 2 },
];

/** Mutate the live REFINE config to a combo (sim-only; a dev harness lever). */
function applyRefineCombo(c: RefineCombo): void {
  const R = REFINE as unknown as {
    statBonusPerRefine: number;
    successChance: Record<number, number>;
    cost: { goldPerTier2Level: number };
  };
  R.statBonusPerRefine = c.bonus;
  R.successChance[8] = c.band[8];
  R.successChance[9] = c.band[9];
  R.successChance[10] = c.band[10];
  R.cost.goldPerTier2Level = 5 * c.goldX;
}

/** A tiny splitmix32 — the HARNESS refine-roll stream (never the engine RNG). */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/**
 * Monte-Carlo the expected number of refine ATTEMPTS to first reach +10 from a
 * fresh (+0) item under the CURRENT REFINE success table, with unlimited
 * mats/gold — the "lottery-ness" metric. Break (+8-10 fail) destroys the item →
 * re-climb from +0; degrade (+4-7 fail) drops one level; safe (+1-3) never fails.
 */
function expectedAttemptsTo10(trials = 40000): number {
  const rng = splitmix32(0xa5a5a5a5);
  let total = 0;
  for (let t = 0; t < trials; t++) {
    let cur = 0;
    let attempts = 0;
    while (cur < REFINE.maxRefine) {
      const target = cur + 1;
      attempts++;
      if (rng() < successChanceForLevel(target)) {
        cur = target;
      } else {
        const mode = failModeForLevel(target);
        if (mode === "degrade") cur = Math.max(0, cur - 1);
        else if (mode === "break") cur = 0;
      }
    }
    total += attempts;
  }
  return total / trials;
}

// ---------------------------------------------------------------------------
// Per-run metrics — keyed by the zone's STAGE (each farm zone / boss room owns one).
// ---------------------------------------------------------------------------

interface ZoneMetric {
  stage: number;
  mapId: string;
  kind: "farm" | "boss";
  enterTime: number;
  /** Time the zone was CLEARED: farm = its quota met (next unlocked); boss = beaten. */
  clearTime: number | null;
  deaths: number;
  bossAttempts: number;
  bossWipes: number;
  levelAtClear: number;
}

interface SeedResult {
  cls: HeroClass;
  seed: number;
  finalStage: number;
  finalLevel: number;
  finalMap: string;
  evolveStage: number | null;
  tier3Stage: number | null;
  finalTier: number;
  totalDeaths: number;
  totalWipes: number;
  zones: ZoneMetric[];
  /** M7: total drops rolled + the final equipped loadout (GEAR run). */
  drops: number;
  /** หินเสริมพลัง (stone-drop conversion): total refine-stones dropped this run +
   * per-map-tier breakdown (index 0..5 = map1..map6) — the salvage-income replacement. */
  stones: number;
  stonesByMap: number[];
  finalWeapon: string | null;
  finalArmor: string | null;
  /** M7.7: potions actually consumed (auto-use) over the run — the mana-sink check. */
  hpPotionsUsed: number;
  manaPotionsUsed: number;
  /** M7.6 ตีบวก refine emulation (REFINE_ON): the material-sink + wall metrics. */
  refine: RefineMetrics;
  /** M7.9b tier-3 QUEST boss (young Sovereign) fight: attempts / deaths in the room /
   * whether it was ever won / the winning fight's duration (seconds). */
  questBoss: { attempts: number; deaths: number; won: boolean; winTime: number | null };
}

interface RefineMetrics {
  matEarned: number;
  matSpent: number;
  refineGold: number;
  goldEarned: number;
  attempts: number;
  breaks: number;
  drops: number;
  townTrips: number;
  /** Time-averaged equipped +N (weapon,armor) sampled while in the s10 / s15 band. */
  s10: { w: number; a: number; n: number };
  s15: { w: number; a: number; n: number };
}

function freshRefineMetrics(): RefineMetrics {
  return {
    matEarned: 0,
    matSpent: 0,
    refineGold: 0,
    goldEarned: 0,
    attempts: 0,
    breaks: 0,
    drops: 0,
    townTrips: 0,
    s10: { w: 0, a: 0, n: 0 },
    s15: { w: 0, a: 0, n: 0 },
  };
}

function makeSave(cls: HeroClass, seed: number): SaveData {
  // A cold-start save at stage 1 (first farm zone). Built directly; the world
  // fields are what initGameState fills for a fresh start, mirrored here.
  return {
    version: SAVE_VERSION,
    stage: 1,
    gold: 0,
    goldEarned: 0,
    bossBest: {},
    levelCapAt: null,
    zoneKills: {},
    location: { mapId: "map1", zoneIdx: 1 },
    unlockedZones: { map1: 2 },
    lastFarmZone: { mapId: "map1", zoneIdx: 1 },
    consumables: { hpPotion: 0, manaPotion: 0, returnScroll: 0, warpScroll: 0 },
    // M7.5: idle bots OFF by default (baseline parity — the sim never trips them).
    bot: {
      enabled: false,
      sellTripEnabled: false,
      hpPotionTarget: 15,
      mpPotionTarget: 15,
      scrollReserve: 3,
      goldReserve: 0,
    },
    // M6.6: auto-hunt ON by default (baseline parity — the sim never toggles it).
    autoHunt: true,
    // M7: cold start owns no gear; deterministic salt + zero counter.
    equipped: { weapon: null, armor: null },
    lootSalt: (seed * 2654435761) >>> 0,
    lootCounter: 0,
    // M7.6 ตีบวก: cold start holds no refine materials.
    materials: 0,
    // ดินแดนอสูร (endgame v1): cold start has no essence / zone counters.
    asuraEssence: 0,
    asuraZoneKills: {},
    hero: {
      cls,
      level: 1,
      xp: 0,
      tier: 1,
      statPoints: 0,
      stats: { ...baseStatsOf(cls) },
      mana: 60,
      autoSlots: [SIGNATURE_SKILL[cls], null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    },
    lastSeen: 0,
  };
}

function baseStatsOf(cls: HeroClass) {
  // Kept minimal to avoid importing CONFIG here — the engine re-derives stats on
  // load, and initGameState clamps; these are the RO-flavour class bases.
  return cls === "swordsman"
    ? { str: 8, dex: 4, int: 3, vit: 6 }
    : cls === "archer"
      ? { str: 4, dex: 8, int: 3, vit: 5 }
      : cls === "ninja"
        ? { str: 5, dex: 8, int: 3, vit: 4 }
        : { str: 3, dex: 4, int: 8, vit: 4 };
}

/** Idle-player auto-slot fill (unchanged from the M5 harness).
 * M7.9 archer-friction pass FIX: pass hero.tier so the TIER-3-gated 4th auto-slot is
 * counted — the pre-fix call defaulted tier=1, so the tier-3 ultimate (archer_storm /
 * sword_skyfall / mage_apocalypse) was NEVER slotted or cast in the organic sim, and
 * the balance-m79 numbers were measured against a phantom hero that never fired its
 * tier-3 skill-4. The real UI passes tier (systems/skills unlockedAutoSlotCount); this
 * aligns the harness with actual play. */
function fillAutoSlots(hero: Hero): { slot: number; skillId: string | null }[] {
  const unlocked = unlockedAutoSlotCount(hero.level, hero.tier);
  const learned = learnedSkills(hero).map((s) => s.id);
  const slotted = new Set(hero.autoSlots.filter((id): id is string => id !== null));
  const out: { slot: number; skillId: string | null }[] = [];
  for (let i = 0; i < unlocked && i < hero.autoSlots.length; i++) {
    if (hero.autoSlots[i]) continue;
    const next = learned.find((id) => !slotted.has(id));
    if (!next) break;
    out.push({ slot: i, skillId: next });
    slotted.add(next);
  }
  return out;
}

/** The map whose BOSS is the s15-style wall immediately before the tier-3 kill map
 * (map4 → map3). Its boss is what a fresh tier-3 hero returns to break. */
function wallBossMapId(killMapId: string): string {
  const maps = CONFIG.world.maps;
  const idx = maps.findIndex((m) => m.id === killMapId);
  return idx > 0 ? maps[idx - 1].id : maps[0].id;
}
/** The LAST farm zoneIdx of `mapId` (town map shifts farms by +1 for the town zone). */
function lastFarmIdx(mapId: string): number {
  const m = CONFIG.world.maps.find((mm) => mm.id === mapId);
  if (!m) return 0;
  const townShift = mapId === CONFIG.world.townMapId ? 1 : 0;
  return townShift + m.zoneStageIds.length - 1;
}

/**
 * World navigation autopilot: walk forward once the current farm zone's quota is
 * met (bossReady) and the next zone is unlocked, enter the boss room, and walk to
 * the next map on a boss-room victory. Between failed boss-room attempts the death
 * -> town -> auto-return loop farms the last zone, so a real "grind + retry" cadence
 * emerges without special-casing it here.
 */
/** Per-seed mutable routing context (M7.9b): remembers the frontier kill count at the last
 * quest-boss challenge so the sim FARMS a bit between failed attempts (a real player grinds
 * gear/levels before retrying) instead of insta-re-challenging a boss it can't yet beat. */
interface NavCtx {
  lastQuestBossChallengeKills: number;
}

/** Frontier kills to bank between quest-boss attempts before re-challenging (gear/xp gain). */
const QUEST_BOSS_FARM_BETWEEN = 70;

function navInput(s: GameState, ctx: NavCtx): Partial<FrameInput> {
  if (s.traveling) return {};
  const nav = worldNav(s);
  const hero = s.heroes[0];
  const walkRight = (): Partial<FrameInput> =>
    nav.right?.unlocked
      ? { walkToZone: { mapId: nav.right.zone.mapId, zoneIdx: nav.right.zone.zoneIdx } }
      : {};
  const walkLeft = (): Partial<FrameInput> =>
    nav.left?.unlocked
      ? { walkToZone: { mapId: nav.left.zone.mapId, zoneIdx: nav.left.zone.zoneIdx } }
      : {};

  // ---- M7.9 tier-3 quest routing (REDESIGN, owner "option ข" 2026-07-08) ----
  // The tier-3 quest (offered Lv40 while tier 2) is now a SINGLE kill objective in the
  // map4-zone-1 FRONTIER (s16), reachable ONLY by fast-travel via the quest PREVIEW grant
  // (systems/world `questGrantsZoneAccess`). No more map2 backtrack. Flow:
  //   Phase A/B (tier 2, quest held): funnel LEFT to town — a guaranteed fast-travel
  //     standoff (+ shopInput keeps a return scroll there) — then fast-travel into the
  //     map4-z1 preview and FARM to bank the kills (death auto-returns to the preview,
  //     which stays the last farm zone while the grant holds). Kills banked → hold while
  //     canEvolveHero fires evolveHero (the tier-3 atk×1.6/hp×1.7 spike).
  //   Phase C (fresh tier 3, map4 NOT yet really unlocked): the grant is gone, so the
  //     preview is now locked — RETURN-SCROLL out to town, then fast-travel to the deepest
  //     unlocked wall-map (map3) farm; the normal forward march below clears s11-15 as the
  //     strong tier-3 hero and ENTERS/BEATS the s15 boss, which does the real map4 unlock.
  const q3 = CONFIG.quest.tier3;
  const preview: WorldLocation = { mapId: q3.killMapId, zoneIdx: 0 };
  const inPreview = s.location.mapId === preview.mapId && s.location.zoneIdx === preview.zoneIdx;
  const map4Unlocked = 0 < (s.unlockedZones[preview.mapId] ?? 0);
  const townLoc: WorldLocation = { mapId: CONFIG.world.townMapId, zoneIdx: 0 };

  // OWNER RULE 2026-07-07 ("ห้ามข้ามแมพ"): the tundra frontier grant is only ENTERABLE once
  // map3's boss room is persist-unlocked (all map3 farm quotas cleared). While the quest is
  // ACCEPTED but the grant isn't enterable yet (`tier3FrontierLocked`), skip the preview
  // routing and fall through to the ordinary forward march below — the tier-2 hero climbs
  // map3 to the boss DOOR. The instant that door persist-unlocks the gate opens, this block
  // engages (funnel to town → fast-travel into map4 z1), so the hero never walks the real s15
  // boss as a tier-2. This preserves the s1-15 fresh-run trajectory byte-for-byte.
  if (
    hero.tier === 2 &&
    hero.quest?.accepted &&
    hero.quest.id === tier3QuestId(hero.cls) &&
    !tier3FrontierLocked(s)
  ) {
    if ((hero.quest.progress[0] ?? 0) < q3.kills) {
      if (inPreview) return {}; // farm the frontier to bank quest kills
      if (nav.current.kind === "town") return { fastTravel: preview };
      return walkLeft(); // funnel to town (safe fast-travel launchpad)
    }
    // ---- M7.9b: kills banked → fight the QUEST BOSS (young Sovereign) in the map4 boss room.
    if ((hero.quest.progress[1] ?? 0) < q3.bossKills) {
      if (s.phase === "boss" || s.phase === "victory") return {}; // fighting / won — let it resolve
      if (inPreview) {
        // Farm the frontier a bit between attempts (gear/xp) so a marginal seed builds power
        // and eventually wins, instead of insta-re-challenging a boss it can't yet beat.
        if (s.kills - ctx.lastQuestBossChallengeKills < QUEST_BOSS_FARM_BETWEEN) return {};
        ctx.lastQuestBossChallengeKills = s.kills;
        return { challengeBoss: true }; // walk DIRECTLY into the map4 boss room
      }
      // Died / retreated out of the frontier → get back to the preview to retry.
      if (nav.current.kind === "town") return { fastTravel: preview };
      return walkLeft();
    }
    return {}; // both objectives done → evolveHero fires; hold until tier 3
  }

  if (hero.tier === 3 && !map4Unlocked) {
    // Post-win escape (M7.9b): a fresh tier-3 hero can be stranded in the now-locked map4
    // frontier OR its boss room (the young-Sovereign victory). The grant is gone, so scroll
    // out to town (instant, works in victory/under threat), else fast-travel when a standoff
    // opens (a farm zone only — the victory phase can't tick a fast-travel channel).
    const inMap4 = s.location.mapId === preview.mapId;
    if (inMap4) {
      if (s.consumables.returnScroll > 0) return { useReturnScroll: true };
      return zoneAt(s.location).kind === "farm" ? { fastTravel: townLoc } : {};
    }
    if (nav.current.kind === "town") {
      const wm = wallBossMapId(q3.killMapId);
      const wc = s.unlockedZones[wm] ?? 0;
      if (wc > 0) return { fastTravel: { mapId: wm, zoneIdx: Math.min(wc - 1, lastFarmIdx(wm)) } };
      // no wall-map progress yet → fall through to the forward march from town.
    }
    // On the wall map (or crossing back) → the normal forward march enters the s15 boss.
  }

  if (s.phase === "victory") return walkRight();
  const kind = nav.current.kind;
  if (kind === "town") return walkRight();
  if (kind === "boss") return {};
  // Move forward on the next zone's UNLOCK (bossReady arms only at the
  // boss-gate zone since 2026-07-07); walkRight no-ops while locked.
  return walkRight();
}

/**
 * Idle-player SHOP autopilot (M6): the ONLY moment the world autopilot passes
 * through town is a death respawn (auto-return pops to town then walks back), so
 * restock potions with surplus gold in that town step — a deterministic "buy on
 * pass-through" rule. Gold is otherwise unused, so spend freely to a target stack;
 * `buyShopItem` is partial (buys as many as gold + stack room allow). One item type
 * per visit (one intent/step); frequent frontier deaths top both over time.
 */
/**
 * M7 gear autopilot (GEAR=1): the hero "owns" whatever drops (the server would
 * mint it) and wears the best-scoring class-compatible item per slot. Weapon score
 * = atk; armor score = def·4 + hp (a rough survivability blend). Desired loadout is
 * the best owned item seen so far; the loop equips toward it one slot per step.
 */
function gearCompatible(t: ItemTemplate, cls: HeroClass): boolean {
  return t.classReq === null || t.classReq === cls;
}
function gearScore(t: ItemTemplate): number {
  return t.slot === "weapon"
    ? (t.stats.atk ?? 0)
    : (t.stats.def ?? 0) * 4 + (t.stats.hp ?? 0);
}
interface OwnedBest {
  weapon: string | null;
  armor: string | null;
}
function considerDrop(best: OwnedBest, templateId: string, cls: HeroClass): void {
  const t = ITEM_TEMPLATES[templateId];
  if (!t || !gearCompatible(t, cls)) return;
  const cur = best[t.slot];
  if (!cur || gearScore(t) > gearScore(ITEM_TEMPLATES[cur])) best[t.slot] = t.id;
}

const RESTOCK_TARGET = 15;
function shopInput(s: GameState): Partial<FrameInput> {
  if (zoneAt(s.location).kind !== "town") return {};
  // Keep a single return scroll in stock — the tier-3 preview-escape (navInput Phase C)
  // uses it, and a real frontier player always carries one. Bought once (cheap), so the
  // baseline gold/refine metrics are ~unchanged.
  if (s.consumables.returnScroll < 1) return { buyShopItem: { item: "returnScroll", qty: 1 } };
  const hp = s.consumables.hpPotion;
  const mana = s.consumables.manaPotion;
  // Restock the LOWER-stock potion first (one intent/step, short town dwell). Over
  // repeated town passes both converge to the target — so BOTH sinks are exercised for
  // every class (the old hp-first rule starved mana restock on high-death classes).
  const buyHp = (): Partial<FrameInput> => ({
    buyShopItem: { item: "hpPotion", qty: RESTOCK_TARGET - hp },
  });
  const buyMana = (): Partial<FrameInput> => ({
    buyShopItem: { item: "manaPotion", qty: RESTOCK_TARGET - mana },
  });
  // Keep a minimum mana reserve so the mana-sink mechanic is always exercised (a
  // high-death class otherwise spends every town step on hp and never holds a mana
  // potion to auto-use). A real player sets both targets / runs the M7.5 restock bot.
  if (mana < 4) return buyMana();
  if (hp <= mana) {
    if (hp < RESTOCK_TARGET) return buyHp();
    if (mana < RESTOCK_TARGET) return buyMana();
  } else {
    if (mana < RESTOCK_TARGET) return buyMana();
    if (hp < RESTOCK_TARGET) return buyHp();
  }
  return {};
}

function runSeed(cls: HeroClass, seed: number): SeedResult {
  const s = initGameState(seed, makeSave(cls, seed));
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;
  // Auto-use potions at the config defaults (initGameState already seeds these ON
  // with the 35%/25% thresholds) — the idle sustain feature under test.

  const zones: ZoneMetric[] = [];
  const byKey = new Map<string, ZoneMetric>();
  const key = (mapId: string, stage: number, kind: string): string => `${mapId}:${stage}:${kind}`;

  let cur: ZoneMetric = freshZone(s);
  byKey.set(key(cur.mapId, cur.stage, cur.kind), cur);
  zones.push(cur);

  let prevPhase = s.phase;
  let prevDead = s.heroes[0].dead;
  let prevTier = s.heroes[0].tier;
  let evolveStage: number | null = null;
  let tier3Stage: number | null = null;
  let totalDeaths = 0;
  let totalWipes = 0;
  // M7.9b quest-boss (young Sovereign) tracking — a tier-2 fight in the map4 boss room.
  const qBoss = { attempts: 0, deaths: 0, won: false, winTime: null as number | null };
  let qBossFightStart: number | null = null;
  const bestOwned: OwnedBest = { weapon: null, armor: null };
  let drops = 0;
  let stones = 0;
  const stonesByMap = [0, 0, 0, 0, 0, 0];
  let hpPotionsUsed = 0;
  let manaPotionsUsed = 0;

  // ---- M7.6 refine emulation run-state (harness plays the server) ----
  const rm = freshRefineMetrics();
  // Harness refine RNG — decorrelated per (class, seed); NEVER the engine stream.
  const rrng = splitmix32(((seed * 0x9e3779b1) ^ (cls.length * 2654435761)) >>> 0);
  const curRefine: Record<GearSlot, number> = { weapon: 0, armor: 0 };
  // Salvage feedstock waiting for the next town trip (RO NPCs are town-only), capped
  // at the inventory cap — a hero who rarely visits town overflows + loses drops.
  let matBank = 0;
  let pendingMat = 0;
  let pendingCount = 0;
  let prevGold = s.gold;
  let prevTown = zoneAt(s.location).kind === "town";

  let lastStressTrip = 0;
  const salvageOf = (templateId: string): number => {
    const t = ITEM_TEMPLATES[templateId];
    return t ? salvageYield(t.tier, t.rarity) : 0;
  };
  // One refine "town visit": flush feedstock → materials, then GREEDILY refine the
  // equipped gear from the SURPLUS gold left after the engine's potion buys.
  const doRefineTrip = (): void => {
    rm.townTrips++;
    matBank += pendingMat;
    rm.matEarned += pendingMat;
    pendingMat = 0;
    pendingCount = 0;
    const eq = s.heroes[0].equipped;
    for (const slot of ["weapon", "armor"] as GearSlot[]) {
      const tid = eq[slot];
      if (!tid) continue;
      const tier = ITEM_TEMPLATES[tid].tier;
      let cur = curRefine[slot];
      let guard = 0;
      while (cur < REFINE.maxRefine && guard++ < 400) {
        const target = cur + 1;
        const cost = refineCost(tier, target);
        const wallet = s.gold - rm.refineGold; // surplus after potions
        if (matBank < cost.materials || wallet < cost.gold) break;
        matBank -= cost.materials;
        rm.matSpent += cost.materials;
        rm.refineGold += cost.gold;
        rm.attempts++;
        if (rrng() < successChanceForLevel(target)) {
          cur = target; // success (parks at +10 until a tier upgrade resets it)
        } else {
          const mode = failModeForLevel(target);
          if (mode === "degrade") cur = Math.max(0, cur - 1);
          else if (mode === "break") {
            rm.breaks++; // item destroyed → re-acquired from the drop stream at +0
            cur = 0;
            break; // stop pushing this slot this trip ("ugh, broke — later")
          }
          // safe: no change
        }
      }
      curRefine[slot] = cur;
    }
  };
  // A drop the player will NOT wear becomes feedstock (the replaced old item too);
  // capped at INVENTORY_CAP pending — overflow is lost until a town trip clears it.
  const feedstock = (templateId: string): void => {
    if (pendingCount >= 100) return;
    pendingCount++;
    pendingMat += salvageOf(templateId);
  };

  const navCtx: NavCtx = { lastQuestBossChallengeKills: -QUEST_BOSS_FARM_BETWEEN };
  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = { ...navInput(s, navCtx), ...shopInput(s) };
    if (isEvolutionQuestOffered(s.heroes[0])) input.acceptQuest = 0;
    if (canEvolveHero(s, s.heroes[0])) input.evolveHero = 0;
    const slots = fillAutoSlots(s.heroes[0]);
    if (slots.length) input.setAutoSlots = slots;
    // Equip toward the best owned item (one slot/step). Weapon first, then armor.
    // A template SWAP (upgrade) equips at +0 (a fresh item, refine reset); when the
    // template already matches, sync the harness-decided +N into the engine so the
    // refine bonus feeds combat (M7.6). One equip intent per step.
    if (GEAR && !input.walkToZone) {
      const eq = s.heroes[0].equipped;
      if (bestOwned.weapon && eq.weapon !== bestOwned.weapon) {
        input.equip = { slot: "weapon", templateId: bestOwned.weapon, refineLevel: 0 };
        curRefine.weapon = 0;
      } else if (bestOwned.armor && eq.armor !== bestOwned.armor) {
        input.equip = { slot: "armor", templateId: bestOwned.armor, refineLevel: 0 };
        curRefine.armor = 0;
      } else if (REFINE_ACTIVE) {
        const wR = eq.weapon ? (eq.refine?.weapon ?? 0) : 0;
        const aR = eq.armor ? (eq.refine?.armor ?? 0) : 0;
        if (eq.weapon && wR !== curRefine.weapon) {
          input.equip = { slot: "weapon", templateId: eq.weapon, refineLevel: curRefine.weapon };
        } else if (eq.armor && aR !== curRefine.armor) {
          input.equip = { slot: "armor", templateId: eq.armor, refineLevel: curRefine.armor };
        }
      }
    }

    step(s, input);

    // Zone clear signals (from events, deterministic).
    for (const e of s.events) {
      if (e.type === "itemDrop") {
        drops++;
        if (REFINE_ACTIVE) {
          rm.drops++;
          // Is this drop a strict upgrade the hero will WEAR? Then the OLD item it
          // replaces becomes feedstock; otherwise the drop itself does.
          const t = ITEM_TEMPLATES[e.templateId];
          if (t && gearCompatible(t, cls)) {
            const cur = bestOwned[t.slot];
            const upgrade = !cur || gearScore(t) > gearScore(ITEM_TEMPLATES[cur]);
            if (upgrade) {
              if (cur) feedstock(cur); // the displaced item is salvaged
            } else {
              feedstock(e.templateId);
            }
          } else {
            feedstock(e.templateId); // class-incompatible drop → pure feedstock
          }
        }
        if (GEAR) considerDrop(bestOwned, e.templateId, cls);
      }
      if (e.type === "stoneDrop") {
        stones += e.qty;
        const mt = Math.max(1, Math.min(6, Math.ceil(s.stage / 5)));
        stonesByMap[mt - 1] += e.qty;
      }
      if (e.type === "consumableUsed") {
        if (e.item === "hpPotion") hpPotionsUsed++;
        else if (e.item === "manaPotion") manaPotionsUsed++;
      }
      if (e.type === "zoneUnlocked" && cur.kind === "farm" && cur.clearTime === null) {
        cur.clearTime = s.time;
        cur.levelAtClear = s.heroes[0].level;
      }
      if (e.type === "mapUnlocked" && cur.kind === "boss" && cur.clearTime === null) {
        cur.clearTime = s.time;
        cur.levelAtClear = s.heroes[0].level;
      }
      if (e.type === "zoneEntered") {
        const k = key(e.mapId, e.stage, e.kind);
        let zm = byKey.get(k);
        if (!zm && (e.kind === "farm" || e.kind === "boss")) {
          zm = { ...freshZone(s), stage: e.stage, mapId: e.mapId, kind: e.kind, enterTime: s.time };
          byKey.set(k, zm);
          zones.push(zm);
        }
        // M7.9b: the map4 boss ROOM is entered twice per run — first as the tier-2 QUEST
        // boss (young Sovereign; tracked separately in qBoss), later as the REAL s20 boss
        // (tier 3). Reset the shared metric on the tier-3 re-entry so the s20-boss agg
        // measures ONLY the real fight, never blended with the earlier quest attempt.
        if (
          zm &&
          e.kind === "boss" &&
          e.mapId === CONFIG.quest.tier3.killMapId &&
          s.heroes[0].tier >= 3
        ) {
          zm.enterTime = s.time;
          zm.clearTime = null;
          zm.deaths = 0;
          zm.bossAttempts = 0;
          zm.bossWipes = 0;
        }
        if (zm && (e.kind === "farm" || e.kind === "boss")) cur = zm;
      }
      if (
        e.type === "bossDefeated" &&
        s.location.mapId === CONFIG.quest.tier3.killMapId &&
        s.heroes[0].tier === 2
      ) {
        // The young Sovereign fell (tier-2, pre-evolve) → the quest-boss win.
        qBoss.won = true;
        if (qBossFightStart !== null) qBoss.winTime = s.time - qBossFightStart;
      }
    }

    // M7.9b quest-boss context: a tier-2 fight in the map4 boss room = the young Sovereign.
    const inQuestBossRoom =
      s.location.mapId === CONFIG.quest.tier3.killMapId &&
      zoneAt(s.location).kind === "boss" &&
      s.heroes[0].tier === 2;

    // Death edge.
    const nowDead = s.heroes[0].dead;
    if (nowDead && !prevDead) {
      cur.deaths++;
      totalDeaths++;
      if (inQuestBossRoom) qBoss.deaths++;
    }
    // Boss-room attempt / wipe edges.
    if (prevPhase !== s.phase) {
      if (s.phase === "boss") {
        cur.bossAttempts++;
        if (inQuestBossRoom) {
          qBoss.attempts++;
          qBossFightStart = s.time;
        }
      }
      if (prevPhase === "boss" && s.phase !== "victory") {
        cur.bossWipes++;
        totalWipes++;
      }
    }
    if (prevTier < s.heroes[0].tier) {
      if (s.heroes[0].tier === 2) evolveStage = s.stage;
      else if (s.heroes[0].tier === 3) tier3Stage = s.stage;
    }

    // ---- M7.6 refine emulation (post-step, harness-side) ----
    if (REFINE_ACTIVE) {
      // Gold income (positive deltas only; potion buys are the engine's, refine
      // spends are virtual so they never touch s.gold — potions ALWAYS buy first).
      const dg = s.gold - prevGold;
      if (dg > 0) rm.goldEarned += dg;
      prevGold = s.gold;

      // Town trip (auto-return death loop passes through town): salvage + greedy
      // refine. REFINE_STRESS_SEC additionally grants a trip on a fixed in-farm
      // cadence (a bot-running player) to stress the wall against heavy refining.
      const nowTown = zoneAt(s.location).kind === "town";
      if (nowTown && !prevTown) doRefineTrip();
      else if (
        REFINE_STRESS_SEC > 0 &&
        !nowTown &&
        s.time - lastStressTrip >= REFINE_STRESS_SEC
      ) {
        lastStressTrip = s.time;
        doRefineTrip();
      }
      prevTown = nowTown;

      // Time-average the equipped +N in the s10 / s15 stage bands.
      if (s.stage === 9 || s.stage === 10) {
        rm.s10.w += curRefine.weapon;
        rm.s10.a += curRefine.armor;
        rm.s10.n++;
      } else if (s.stage === 14 || s.stage === 15) {
        rm.s15.w += curRefine.weapon;
        rm.s15.a += curRefine.armor;
        rm.s15.n++;
      }
    }

    prevPhase = s.phase;
    prevDead = nowDead;
    prevTier = s.heroes[0].tier;
  }

  return {
    cls,
    seed,
    finalStage: s.stage,
    finalLevel: s.heroes[0].level,
    finalMap: s.location.mapId,
    evolveStage,
    tier3Stage,
    finalTier: s.heroes[0].tier,
    totalDeaths,
    totalWipes,
    zones,
    drops,
    stones,
    stonesByMap,
    finalWeapon: s.heroes[0].equipped.weapon,
    finalArmor: s.heroes[0].equipped.armor,
    hpPotionsUsed,
    manaPotionsUsed,
    refine: rm,
    questBoss: qBoss,
  };
}

// ---------------------------------------------------------------------------
// M8 SAME-ZONE COHORT harness (PARTY=2/3) — "Cohort exp pass" (docs/balance-m79.md).
// N heroes share ONE zone's progression on full autopilot. Per-hero input lanes drive
// each hero's auto-slots / quest-accept / evolve; the shared-zone nav + shop ride lane 0
// (the "lead", exactly as the lockstep contract routes them). Measures the reward
// incentive (per-member xp/hr vs solo), starvation (kills/hero/min vs solo), deaths, and
// boss clear time (headcount trivialization check).
// ---------------------------------------------------------------------------

const MIX_CLASSES: HeroClass[] = ["swordsman", "archer", "mage"];

/** Cumulative xp EARNED by a hero (levels consumed + partial), the xp/hr numerator. */
function totalXpOf(hero: Hero): number {
  let t = hero.xp;
  for (let l = 1; l < hero.level; l++) t += CONFIG.leveling.xpToLevel(l);
  return t;
}

/** Full-autopilot config for a cohort hero (solo mirrors globals; a cohort can't). */
function configCohortHero(h: Hero): void {
  h.config.autoCast = true;
  h.config.autoAllocate = true;
  h.config.autoHunt = true;
  // autoHpPotion / autoManaPotion + thresholds are already ON from defaultHeroConfig.
}

interface CohortRun {
  size: number;
  perHeroXp: number[];
  killEvents: number;
  deaths: number;
  finalStage: number;
  finalLevels: number[];
  /** stage → farm-zone clear duration (s) for zones cleared this run. */
  farmClears: Map<number, number>;
  /** stage → boss-room clear duration (s) for bosses beaten this run. */
  bossClears: Map<number, number>;
  /** boss stages ENTERED but never cleared (a wall that still stands at this headcount). */
  bossWalls: Set<number>;
}

/**
 * Run one cohort of `size` heroes (mixed = the [sword,archer,mage] trio, else `baseCls`×N)
 * on the shared-zone autopilot for the standard horizon. size=1 = the apples-to-apples
 * baseline through the SAME runner.
 */
function runCohort(baseCls: HeroClass, seed: number, size: number, mixed: boolean): CohortRun {
  const s = initGameState(seed, makeSave(mixed ? MIX_CLASSES[0] : baseCls, seed));
  s.autoReturn = true;
  s.autoCast = true;
  s.autoAllocate = true;
  configCohortHero(s.heroes[0]);
  for (let i = 1; i < size; i++) {
    const cls = mixed ? MIX_CLASSES[i % MIX_CLASSES.length] : baseCls;
    const h = makeHero(s.nextId++, cls);
    configCohortHero(h);
    s.heroes.push(h);
  }

  const perDead = s.heroes.map((h) => h.dead);
  let killEvents = 0;
  let deaths = 0;
  const farmClears = new Map<number, number>();
  const bossClears = new Map<number, number>();
  const bossWalls = new Set<number>();
  let zoneStage = zoneAt(s.location).stage;
  let zoneKind = zoneAt(s.location).kind;
  let zoneEnter = s.time;

  const navCtx: NavCtx = { lastQuestBossChallengeKills: -QUEST_BOSS_FARM_BETWEEN };
  for (let step_i = 0; step_i < STEPS; step_i++) {
    const lanes: FrameInput[] = [];
    for (let i = 0; i < size; i++) {
      const h = s.heroes[i];
      const lane: FrameInput = {};
      const slots = fillAutoSlots(h);
      if (slots.length) lane.setAutoSlots = slots;
      if (isEvolutionQuestOffered(h)) lane.acceptQuest = i;
      if (canEvolveHero(s, h)) lane.evolveHero = i;
      lanes.push(lane);
    }
    // Shared-zone intents (nav + shop) ride lane 0 (the lead), per the lockstep contract.
    Object.assign(lanes[0], navInput(s, navCtx), shopInput(s));

    step(s, lanes);

    for (const e of s.events) {
      if (e.type === "kill") killEvents++;
      if (e.type === "zoneEntered") {
        // A boss room we're LEAVING without a clear = a wall that held.
        if (zoneKind === "boss" && !bossClears.has(zoneStage)) bossWalls.add(zoneStage);
        zoneStage = e.stage;
        zoneKind = e.kind === "boss" ? "boss" : e.kind === "farm" ? "farm" : zoneKind;
        zoneEnter = s.time;
      }
      if (e.type === "zoneUnlocked" && zoneKind === "farm" && !farmClears.has(zoneStage)) {
        farmClears.set(zoneStage, s.time - zoneEnter);
      }
      if (e.type === "mapUnlocked" && zoneKind === "boss") {
        bossClears.set(zoneStage, s.time - zoneEnter);
        bossWalls.delete(zoneStage);
      }
    }

    for (let i = 0; i < size; i++) {
      const nowDead = s.heroes[i].dead;
      if (nowDead && !perDead[i]) deaths++;
      perDead[i] = nowDead;
    }
  }

  return {
    size,
    perHeroXp: s.heroes.map(totalXpOf),
    killEvents,
    deaths,
    finalStage: s.stage,
    finalLevels: s.heroes.map((h) => h.level),
    farmClears,
    bossClears,
    bossWalls,
  };
}

const HOURS = SIM_SECONDS / 3600;
const MINUTES = SIM_SECONDS / 60;

/** Mean of the defined values in a list of per-run maps at `stage`. */
function meanAtStage(runs: CohortRun[], stage: number, pick: (r: CohortRun) => Map<number, number>): number | null {
  const vals = runs.map((r) => pick(r).get(stage)).filter((v): v is number => v !== undefined);
  return vals.length ? mean(vals) : null;
}

function reportCohort(label: string, solo: CohortRun[], cohort: CohortRun[]): void {
  const size = cohort[0].size;
  const soloXpHr = mean(solo.flatMap((r) => r.perHeroXp)) / HOURS;
  const cohXpHr = mean(cohort.flatMap((r) => r.perHeroXp)) / HOURS;
  const soloKpm = mean(solo.map((r) => r.killEvents / r.size)) / MINUTES;
  const cohKpm = mean(cohort.map((r) => r.killEvents / r.size)) / MINUTES;
  console.log(`\n=== COHORT ${label} (size ${size}) — ${cohort.length} seeds vs solo baseline ===`);
  console.log(
    `  xp/hr per member:  solo ${soloXpHr.toFixed(0)}  →  cohort ${cohXpHr.toFixed(0)}  ` +
      `(×${(cohXpHr / Math.max(1, soloXpHr)).toFixed(2)} per member)`,
  );
  console.log(
    `  kills/hero/min:    solo ${soloKpm.toFixed(2)}  →  cohort ${cohKpm.toFixed(2)}  ` +
      `(${((100 * cohKpm) / Math.max(1e-9, soloKpm)).toFixed(0)}% of solo — starvation if < ~70%)`,
  );
  console.log(
    `  deaths (total):    solo ${(mean(solo.map((r) => r.deaths))).toFixed(0)}/run  →  ` +
      `cohort ${(mean(cohort.map((r) => r.deaths))).toFixed(0)}/run  ` +
      `| final stage solo ${Math.round(mean(solo.map((r) => r.finalStage)))} cohort ${Math.round(mean(cohort.map((r) => r.finalStage)))}`,
  );
  // Farm clear time per stage (solo vs cohort), and boss clear time + walls.
  const stages = [...new Set(cohort.flatMap((r) => [...r.farmClears.keys()]))].sort((a, b) => a - b);
  const farmRow = stages
    .map((st) => {
      const so = meanAtStage(solo, st, (r) => r.farmClears);
      const co = meanAtStage(cohort, st, (r) => r.farmClears);
      return so !== null && co !== null ? `s${st}:${co.toFixed(0)}/${so.toFixed(0)}` : null;
    })
    .filter((x): x is string => x !== null);
  console.log(`  farm clear s (cohort/solo): ${farmRow.join("  ")}`);
  const bossStages = [5, 10, 15, 20, 25, 30];
  const bossRow = bossStages
    .map((st) => {
      const so = meanAtStage(solo, st, (r) => r.bossClears);
      const co = meanAtStage(cohort, st, (r) => r.bossClears);
      if (co === null && so === null) return null;
      const coS = co === null ? "-" : co.toFixed(0);
      const soS = so === null ? "-" : so.toFixed(0);
      return `s${st}:${coS}/${soS}`;
    })
    .filter((x): x is string => x !== null);
  console.log(`  BOSS clear s (cohort/solo): ${bossRow.join("  ")}`);
  // Trivialization flag: a boss whose cohort clear time collapsed vs solo.
  const trivi = bossStages
    .map((st) => {
      const so = meanAtStage(solo, st, (r) => r.bossClears);
      const co = meanAtStage(cohort, st, (r) => r.bossClears);
      if (so === null || co === null || so < 1) return null;
      const ratio = co / so;
      return ratio < 0.55 ? `s${st} (×${ratio.toFixed(2)} of solo time)` : null;
    })
    .filter((x): x is string => x !== null);
  const wallStages = [15, 20, 25, 30].filter((st) => cohort.some((r) => r.bossWalls.has(st)));
  if (trivi.length) console.log(`  ⚠ BOSS TRIVIALIZED (< 0.55× solo clear time): ${trivi.join(", ")}`);
  if (wallStages.length) console.log(`  wall still stands (not cleared every seed at this size): s${wallStages.join(", s")}`);
}

function runParty(): void {
  console.log(
    `[cohort-sim] PARTY=${PARTY}${PARTY_MIX ? " MIXED[sword,archer,mage]" : ""} ` +
      `${SIM_SECONDS}s × ${SEEDS.length} seeds — same-zone cohort vs solo baseline\n` +
      `knobs: expShareRate ${CONFIG.party.expShareRate} · expBuffPerMember ${CONFIG.party.expBuffPerMember} ` +
      `(buff 2p ×${CONFIG.party.expBuff(2).toFixed(2)} 3p ×${CONFIG.party.expBuff(3).toFixed(2)}) · ` +
      `spawnScale 2p ×${CONFIG.party.spawnMaxAliveScale(2).toFixed(2)} 3p ×${CONFIG.party.spawnMaxAliveScale(3).toFixed(2)} · ` +
      `expKillMult 2p ×${CONFIG.party.expKillMult(2, 2).toFixed(3)} 3p ×${CONFIG.party.expKillMult(3, 3).toFixed(3)}`,
  );
  if (PARTY_MIX) {
    const cohort = SEEDS.map((seed) => runCohort("swordsman", seed, 3, true));
    // Baseline: each mixed hero vs its OWN class solo, so per-member xp/hr is per-class fair.
    const soloByClass = new Map<HeroClass, CohortRun[]>();
    for (const cls of MIX_CLASSES) soloByClass.set(cls, SEEDS.map((seed) => runCohort(cls, seed, 1, false)));
    // Blend the three class solos into a "baseline" whose per-hero xp aligns slot-for-slot.
    const soloBlend: CohortRun[] = SEEDS.map((_, si) => ({
      ...cohort[si],
      perHeroXp: MIX_CLASSES.map((cls) => soloByClass.get(cls)![si].perHeroXp[0]),
      killEvents: MIX_CLASSES.reduce((a, cls) => a + soloByClass.get(cls)![si].killEvents, 0),
      deaths: MIX_CLASSES.reduce((a, cls) => a + soloByClass.get(cls)![si].deaths, 0),
      size: 3,
      farmClears: soloByClass.get("swordsman")![si].farmClears,
      bossClears: soloByClass.get("swordsman")![si].bossClears,
    }));
    reportCohort("MIXED[sword,archer,mage]", soloBlend, cohort);
    return;
  }
  for (const cls of CLASSES) {
    const solo = SEEDS.map((seed) => runCohort(cls, seed, 1, false));
    const cohort = SEEDS.map((seed) => runCohort(cls, seed, PARTY, false));
    reportCohort(`${PARTY}×${cls}`, solo, cohort);
  }
}

function freshZone(s: GameState): ZoneMetric {
  const z = zoneAt(s.location);
  return {
    stage: z.stage,
    mapId: z.mapId,
    kind: z.kind === "boss" ? "boss" : "farm",
    enterTime: s.time,
    clearTime: null,
    deaths: 0,
    bossAttempts: 0,
    bossWipes: 0,
    levelAtClear: s.heroes[0].level,
  };
}

// ---------------------------------------------------------------------------
// Aggregation + reporting (per zone, keyed by map:stage).
// ---------------------------------------------------------------------------

const pad = (v: unknown, w: number): string => String(v).padEnd(w);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

interface ZoneAgg {
  mapId: string;
  stage: number;
  kind: "farm" | "boss";
  clears: number;
  meanDur: number | null;
  meanLevel: number | null;
  deaths: number;
  wipes: number;
}

function aggregate(results: SeedResult[]): ZoneAgg[] {
  const keys = new Map<string, { mapId: string; stage: number; kind: "farm" | "boss" }>();
  for (const r of results) {
    for (const z of r.zones) keys.set(`${z.mapId}:${z.stage}:${z.kind}`, z);
  }
  const ordered = [...keys.values()].sort((a, b) => a.stage - b.stage || a.kind.localeCompare(b.kind));
  const out: ZoneAgg[] = [];
  for (const kz of ordered) {
    const all = results.flatMap((r) =>
      r.zones.filter((z) => z.mapId === kz.mapId && z.stage === kz.stage && z.kind === kz.kind),
    );
    const cleared = all.filter((z) => z.clearTime !== null);
    const durs = cleared.map((z) => z.clearTime! - z.enterTime);
    out.push({
      mapId: kz.mapId,
      stage: kz.stage,
      kind: kz.kind,
      clears: cleared.length,
      meanDur: durs.length ? mean(durs) : null,
      meanLevel: cleared.length ? mean(cleared.map((z) => z.levelAtClear)) : null,
      deaths: all.reduce((a, z) => a + z.deaths, 0),
      wipes: all.reduce((a, z) => a + z.bossWipes, 0),
    });
  }
  return out;
}

/** Aggregate refine metrics across seeds (per-run means, band-weighted +N means). */
function aggRefine(results: SeedResult[]): {
  s10w: number; s10a: number; s15w: number; s15a: number;
  matEarned: number; matSpent: number; refineGold: number; goldEarned: number;
  attempts: number; breaks: number; drops: number; townTrips: number;
} {
  const n = Math.max(1, results.length);
  const bandMean = (sel: (m: RefineMetrics) => { w: number; a: number; n: number }) => {
    let w = 0, a = 0, cnt = 0;
    for (const r of results) {
      const b = sel(r.refine);
      w += b.w; a += b.a; cnt += b.n;
    }
    return { w: w / Math.max(1, cnt), a: a / Math.max(1, cnt) };
  };
  const s10 = bandMean((m) => m.s10);
  const s15 = bandMean((m) => m.s15);
  const sum = (sel: (m: RefineMetrics) => number) => results.reduce((x, r) => x + sel(r.refine), 0) / n;
  return {
    s10w: s10.w, s10a: s10.a, s15w: s15.w, s15a: s15.a,
    matEarned: sum((m) => m.matEarned), matSpent: sum((m) => m.matSpent),
    refineGold: sum((m) => m.refineGold), goldEarned: sum((m) => m.goldEarned),
    attempts: sum((m) => m.attempts), breaks: sum((m) => m.breaks),
    drops: sum((m) => m.drops), townTrips: sum((m) => m.townTrips),
  };
}

function printClass(cls: HeroClass, results: SeedResult[], agg: ZoneAgg[]): void {
  const n = results.length;
  console.log(`\n=== ${cls.toUpperCase()} (solo, world) — ${n} seeds ===`);
  console.log(
    "  " +
      pad("zone", 12) +
      pad("kind", 6) +
      pad("clears", 8) +
      pad("meanDur", 9) +
      pad("lvl", 6) +
      pad("deaths", 8) +
      pad("wipes", 7),
  );
  for (const a of agg) {
    console.log(
      "  " +
        pad(`${a.mapId}/s${a.stage}`, 12) +
        pad(a.kind, 6) +
        pad(`${a.clears}/${n}`, 8) +
        pad(a.meanDur === null ? "-" : a.meanDur.toFixed(1), 9) +
        pad(a.meanLevel === null ? "-" : a.meanLevel.toFixed(0), 6) +
        pad(a.deaths, 8) +
        pad(a.wipes, 7),
    );
  }
  console.log(
    `  - reached: ${results.map((r) => `${r.finalMap}/s${r.finalStage}`).join(", ")}`,
  );
  console.log(
    `  - final levels: ${results.map((r) => r.finalLevel).join(",")} | ` +
      `class-change(t2) stage: ${results.map((r) => r.evolveStage ?? "-").join(",")} | ` +
      `tier3 stage: ${results.map((r) => r.tier3Stage ?? "-").join(",")} | ` +
      `final tier: ${results.map((r) => r.finalTier).join(",")} | ` +
      `deaths: ${results.reduce((a, r) => a + r.totalDeaths, 0)} | ` +
      `boss wipes: ${results.reduce((a, r) => a + r.totalWipes, 0)}`,
  );
  // M7.9b tier-3 QUEST boss (young Sovereign): per-seed attempts/deaths + win time.
  const qb = results.map((r) => r.questBoss);
  console.log(
    `  - tier3 quest-boss (young Sovereign): attempts ${qb.map((q) => q.attempts).join(",")} | ` +
      `deaths ${qb.map((q) => q.deaths).join(",")} | ` +
      `won ${qb.map((q) => (q.won ? "Y" : "N")).join(",")} | ` +
      `winT ${qb.map((q) => (q.winTime === null ? "-" : q.winTime.toFixed(1) + "s")).join(",")}`,
  );
  // M7.7 mana-sink check: total + per-seed potions consumed (auto-use).
  const hpTot = results.reduce((a, r) => a + r.hpPotionsUsed, 0);
  const mpTot = results.reduce((a, r) => a + r.manaPotionsUsed, 0);
  console.log(
    `  - potions used (${n} seeds): hp ${hpTot} (${(hpTot / n).toFixed(0)}/run) | ` +
      `mana ${mpTot} (${(mpTot / n).toFixed(0)}/run) [per-seed mana: ${results.map((r) => r.manaPotionsUsed).join(",")}]`,
  );
  if (GEAR) {
    console.log(
      `  - drops: ${results.map((r) => r.drops).join(",")} | ` +
        `final gear: ${results.map((r) => `${r.finalWeapon ?? "-"}/${r.finalArmor ?? "-"}`).join(" ")}`,
    );
    // หินเสริมพลัง stone-drop conversion: total stones/run + per-map-tier income (the
    // salvage-income replacement — compare the total vs REFINE's `mat earned`/run).
    const stoneRuns = results.map((r) => r.stones);
    const stoneTot = stoneRuns.reduce((a, b) => a + b, 0);
    const bandMean = [0, 1, 2, 3, 4, 5].map(
      (i) => results.reduce((a, r) => a + (r.stonesByMap[i] ?? 0), 0) / n,
    );
    console.log(
      `  - หินเสริมพลัง stones: ${stoneRuns.join(",")} (${(stoneTot / n).toFixed(0)}/run) | ` +
        `by map (mean/run): ${bandMean.map((v, i) => `m${i + 1}:${v.toFixed(0)}`).join(" ")}`,
    );
  }
  if (REFINE_ON) {
    const agg = aggRefine(results);
    console.log(
      `  - refine: +N@s10 w${agg.s10w.toFixed(1)}/a${agg.s10a.toFixed(1)} · ` +
        `+N@s15 w${agg.s15w.toFixed(1)}/a${agg.s15a.toFixed(1)} | ` +
        `mat earned ${agg.matEarned.toFixed(0)} spent ${agg.matSpent.toFixed(0)} | ` +
        `refineGold ${agg.refineGold.toFixed(0)} of ${agg.goldEarned.toFixed(0)} earned ` +
        `(${((100 * agg.refineGold) / Math.max(1, agg.goldEarned)).toFixed(0)}%) | ` +
        `attempts ${agg.attempts.toFixed(0)} breaks ${agg.breaks.toFixed(0)}/${agg.drops.toFixed(0)} drops | ` +
        `town trips ${agg.townTrips.toFixed(0)}`,
    );
  }
  // Frontier flag: which zones did NOT clear on every seed (a wall/soft-wall).
  const walls = agg.filter((a) => a.clears < n).map((a) => `${a.mapId}/s${a.stage}(${a.kind})`);
  if (walls.length) console.log(`  - not cleared on every seed (frontier): ${walls.join(", ")}`);
}

/**
 * Refine parameter sweep (REFINE=sweep GEAR=1): run the class×seed matrix for each
 * combo in REFINE_GRID and print a compact comparison — the wall gates (s15 boss
 * clears must stay 0, class change ~s5), the material sink (+N@s10/s15, mat/gold
 * earned vs spent), and the lottery (attempts-to-+10, breaks vs drops).
 */
function runSweep(): void {
  console.log(
    `[refine-sweep] ${SIM_SECONDS}s × ${SEEDS.length} seeds × ${CLASSES.length} classes ` +
      `per combo, ${REFINE_GRID.length} combos\n`,
  );
  const head =
    "  " + pad("combo", 20) + pad("chg", 5) + pad("s15boss", 9) + pad("s15farm", 9) +
    pad("+N@s10", 12) + pad("+N@s15", 12) + pad("mat e/s", 14) + pad("gold%", 7) +
    pad("brk/drop", 11) + pad("→+10", 7);
  console.log(head);
  for (const combo of REFINE_GRID) {
    applyRefineCombo(combo);
    const att10 = expectedAttemptsTo10();
    // Aggregate over ALL classes×seeds for the combo.
    let s15boss = 0, s15bossTot = 0, s15farm = 0, s15farmTot = 0;
    const chgStages: number[] = [];
    const all: SeedResult[] = [];
    for (const cls of CLASSES) {
      for (const seed of SEEDS) {
        const r = runSeed(cls, seed);
        all.push(r);
        if (r.evolveStage !== null) chgStages.push(r.evolveStage);
        const bossZone = r.zones.find((z) => z.kind === "boss" && z.stage === 15);
        if (bossZone) {
          s15bossTot++;
          if (bossZone.clearTime !== null) s15boss++;
        }
        const farmZone = r.zones.find((z) => z.kind === "farm" && z.stage === 15);
        if (farmZone) {
          s15farmTot++;
          if (farmZone.clearTime !== null) s15farm++;
        }
      }
    }
    const g = aggRefine(all);
    const chg = chgStages.length ? (chgStages.reduce((a, b) => a + b, 0) / chgStages.length).toFixed(1) : "-";
    const goldPct = ((100 * g.refineGold) / Math.max(1, g.goldEarned)).toFixed(0) + "%";
    console.log(
      "  " +
        pad(combo.label, 20) +
        pad(chg, 5) +
        pad(`${s15boss}/${s15bossTot}`, 9) +
        pad(`${s15farm}/${s15farmTot}`, 9) +
        pad(`w${g.s10w.toFixed(1)}/a${g.s10a.toFixed(1)}`, 12) +
        pad(`w${g.s15w.toFixed(1)}/a${g.s15a.toFixed(1)}`, 12) +
        pad(`${g.matEarned.toFixed(0)}/${g.matSpent.toFixed(0)}`, 14) +
        pad(goldPct, 7) +
        pad(`${g.breaks.toFixed(0)}/${g.drops.toFixed(0)}`, 11) +
        pad(att10.toFixed(0), 7),
    );
  }
}

// ---------------------------------------------------------------------------
// BOSS-ISOLATION mode (BOSSISO=1) — gate 4/6 verifier (M7.9). Drops a MAXED tier-3
// hero (L90, full t10+10 gear, ratio-allocated stats) at each frontier boss map's
// last farm zone and walks it into the boss room, then reports WIN + kill time. This
// isolates the boss fight from the organic grind (the death-only town cadence never
// reaches +10 gear, so the organic run under-samples the intended endgame band). The
// gate: all 3 classes win s20/s25/s30 at t10+10 (s30 stays the hard soft-wall — only
// a maxed, refined tier-3 hero breaches it). Uses the SAME combat machinery as runSeed
// (auto-cast full kit + auto-potion); no engine internals touched.
// ---------------------------------------------------------------------------
const ISO_STATS: Record<HeroClass, { str: number; dex: number; int: number; vit: number }> = {
  // level-90 hero ≈ 270 allocated points spread on the class auto-ratio, on top of base.
  swordsman: { str: 188, dex: 4, int: 48, vit: 51 },
  archer: { str: 4, dex: 224, int: 57, vit: 5 },
  mage: { str: 3, dex: 4, int: 210, vit: 72 },
  // Ninja (SAVE v18): 4 DEX : 1 VIT : 1 INT sim ratio on ~267 points, on top of the ninja base.
  ninja: { str: 5, dex: 186, int: 47, vit: 48 },
};
// NINJA gear (SAVE v18): the REAL ninja DAGGER templates (classReq "ninja", GEAR wave 2)
// now drive the ninja iso runs; armor is the shared universal line. Ninja is NOT in the
// default CLASSES, so the canonical sim never reads these entries → default runs stay
// byte-identical.
const ISO_GEAR: Record<HeroClass, { weapon: string; armor: string }> = {
  swordsman: { weapon: "w_sword_t10_apocalypse", armor: "a_infernal_t10_aegis" },
  archer: { weapon: "w_bow_t10_apocalypse", armor: "a_infernal_t10_aegis" },
  mage: { weapon: "w_staff_t10_apocalypse", armor: "a_infernal_t10_aegis" },
  ninja: { weapon: "w_dagger_t10_apocalypse", armor: "a_infernal_t10_aegis" },
};
// Each frontier boss map: last-farm zoneIdx (just left of the boss room) + full-unlock counts.
const ISO_BOSSES = [
  { stage: 20, mapId: "map4", lastFarmIdx: 4 },
  { stage: 25, mapId: "map5", lastFarmIdx: 4 },
  { stage: 30, mapId: "map6", lastFarmIdx: 4 },
];

function makeIsoSave(cls: HeroClass, mapId: string, lastFarmIdx: number, stage: number): SaveData {
  const g = ISO_GEAR[cls];
  return {
    version: SAVE_VERSION,
    stage,
    gold: 0,
    goldEarned: 0,
    bossBest: {},
    levelCapAt: null,
    zoneKills: {},
    location: { mapId, zoneIdx: lastFarmIdx },
    // Unlock every zone of every map so the boss room (idx 5) is walkable.
    unlockedZones: { map1: 7, map2: 6, map3: 6, map4: 6, map5: 6, map6: 6 },
    lastFarmZone: { mapId, zoneIdx: lastFarmIdx },
    consumables: { hpPotion: 99, manaPotion: 99, returnScroll: 3, warpScroll: 0 },
    bot: { enabled: false, sellTripEnabled: false, hpPotionTarget: 15, mpPotionTarget: 15, scrollReserve: 3, goldReserve: 0 },
    autoHunt: true,
    equipped: { weapon: g.weapon, armor: g.armor, refine: { weapon: 10, armor: 10 } },
    lootSalt: 1,
    lootCounter: 0,
    materials: 0,
    asuraEssence: 0,
    asuraZoneKills: {},
    hero: {
      cls,
      level: 90,
      xp: 0,
      tier: 3,
      statPoints: 0,
      stats: { ...ISO_STATS[cls] },
      mana: 300,
      autoSlots: [SIGNATURE_SKILL[cls], null, null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    },
    lastSeen: 0,
  };
}

function runBossIso(): void {
  console.log(`[boss-iso M7.9] maxed L90 tier-3 hero, full t10+10 gear — win/time per frontier boss\n`);
  console.log("  " + pad("boss", 10) + CLASSES.map((c) => pad(c, 16)).join(""));
  for (const boss of ISO_BOSSES) {
    const cells = CLASSES.map((cls) => {
      const s = initGameState(1, makeIsoSave(cls, boss.mapId, boss.lastFarmIdx, boss.stage));
      s.autoCast = true;
      s.autoAllocate = true;
      s.autoReturn = false; // isolate the single attempt (no respawn-grind loop)
      let won = false;
      let entered = false;
      let enterTime = 0;
      const cap = Math.round(240 / FIXED_DT);
      const navCtx: NavCtx = { lastQuestBossChallengeKills: -QUEST_BOSS_FARM_BETWEEN };
      for (let i = 0; i < cap; i++) {
        const input: FrameInput = { ...navInput(s, navCtx) };
        const slots = fillAutoSlots(s.heroes[0]);
        if (slots.length) input.setAutoSlots = slots;
        step(s, input);
        if (!entered && zoneAt(s.location).kind === "boss") {
          entered = true;
          enterTime = s.time;
        }
        for (const e of s.events) {
          if (e.type === "mapUnlocked" || (e.type === "frontierCleared")) won = true;
        }
        if (s.phase === "victory") won = true;
        if (won) break;
        if (s.heroes[0].dead && s.autoReturn === false && zoneAt(s.location).kind === "boss") {
          // Died in the boss room with no respawn-grind → a wipe. Give the forced-combat
          // revive a moment; if still dead next check we count it a loss (break on timeout).
        }
      }
      const dur = entered ? s.time - enterTime : 0;
      return pad(won ? `WIN ${dur.toFixed(1)}s` : "LOSS", 16);
    });
    console.log("  " + pad(`s${boss.stage}`, 10) + cells.join(""));
  }
}

// ---------------------------------------------------------------------------
// WORLD BOSS mode (WORLDBOSS=1) — "เสี่ยจ๋อง" gate verifier (this wave).
// Seats a hero/party in the world-boss farm zone (map1), isolates the mob field,
// injects the spawnWorldBoss intent, and runs the 15-min window on full autopilot
// (auto-cast full kit + auto-slots + auto-potion). Measures time-to-kill, whether
// the 15-min window suffices, and hero deaths. Because the isolated boss fight draws
// NO RNG (fixed mechanic timing + fixed skill-offset tables, mobs frozen) it is fully
// DETERMINISTIC — one seed is canonical. Two hero profiles:
//   - SOLO MAXED: L90 tier-3 t10+10 (ISO_STATS/ISO_GEAR) — the party-gate ceiling.
//   - PARTY member: Lv-parametric (default 60) tier-3 t8 gear +6 — the 2-6p target.
// ---------------------------------------------------------------------------

type Stats = { str: number; dex: number; int: number; vit: number };

/** Dev-harness world-boss knob override (sim-only sweep, mutates the live CONFIG.worldBoss
 *  like applyPartyTune/applyRefineCombo). Env: WB_HP, WB_ATK, WB_SLAM, WB_CHARGE, WB_HAZTICK,
 *  WB_SLAMCD, WB_ENRAGE. */
function applyWorldBossTune(): void {
  const W = WORLD_BOSS as unknown as {
    hp: number; atk: number;
    boss: { slamMult: number; slamCdNormal: number; slamCdEnraged: number; enrageThreshold: number };
    bossBehavior: { charge: { hitMult: number }; hazard: { tickMult: number } };
  };
  const num = (k: string): number | undefined =>
    process.env[k] === undefined ? undefined : Number(process.env[k]);
  const hp = num("WB_HP"); if (hp !== undefined) W.hp = hp;
  const atk = num("WB_ATK"); if (atk !== undefined) W.atk = atk;
  const slam = num("WB_SLAM"); if (slam !== undefined) W.boss.slamMult = slam;
  const charge = num("WB_CHARGE"); if (charge !== undefined) W.bossBehavior.charge.hitMult = charge;
  const haz = num("WB_HAZTICK"); if (haz !== undefined) W.bossBehavior.hazard.tickMult = haz;
  const scd = num("WB_SLAMCD"); if (scd !== undefined) W.boss.slamCdNormal = scd;
  const enr = num("WB_ENRAGE"); if (enr !== undefined) W.boss.enrageThreshold = enr;
}

const WB_SEED = 1;
const WB_WINDOW = 0;
const WB_LOC = worldBossLocationFor(WB_WINDOW)!;
const WB_LIFETIME_S = WORLD_BOSS.lifetimeMs / 1000;

// Env knobs for the party profile (owner said ~Lv50-70 / era gear): tune the sweep
// without recompiling. WB_LEVEL = party member level, WB_REFINE = gear +N.
const WB_LEVEL = Math.round(Number(process.env.WB_LEVEL ?? 60));
const WB_REFINE = Math.round(Number(process.env.WB_REFINE ?? 6));

// Ninja gear = the real dagger line (GEAR wave 2); armor uses the universal chain.
const T8_WEAPON: Record<HeroClass, string> = {
  swordsman: "w_sword_t8_dune",
  archer: "w_bow_t8_dune",
  mage: "w_staff_t8_dune",
  ninja: "w_dagger_t8_dune",
};
const T8_ARMOR: Record<HeroClass, string> = {
  swordsman: "a_sword_t8_bulwark",
  archer: "a_archer_t8_stalker",
  mage: "a_mage_t8_seer",
  ninja: "a_dune_t8_plate",
};

/** Class auto-allocate ratio (auto-alloc v2, docs/balance-m7): sword 4STR:1VIT,
 *  archer PURE DEX, mage 3INT:1VIT — applied to (level-1)*pointsPerLevel points. */
function allocStats(cls: HeroClass, level: number): Stats {
  const pts = Math.max(0, (level - 1) * CONFIG.stats.pointsPerLevel);
  const b = baseStatsOf(cls);
  if (cls === "swordsman") {
    const v = Math.round(pts / 5);
    return { str: b.str + (pts - v), dex: b.dex, int: b.int, vit: b.vit + v };
  }
  if (cls === "archer") return { str: b.str, dex: b.dex + pts, int: b.int, vit: b.vit };
  if (cls === "ninja") {
    // Ninja SIM ratio (SAVE v18, ninja balance wave): 4 DEX : 1 VIT : 1 INT — DEX majority
    // (damage+tempo), VIT floors the thin melee body, INT deepens the mana pool (massacre).
    const v = Math.round(pts / 6);
    const int = Math.round(pts / 6);
    return { str: b.str, dex: b.dex + (pts - v - int), int: b.int + int, vit: b.vit + v };
  }
  const v = Math.round(pts / 4);
  return { str: b.str, dex: b.dex, int: b.int + (pts - v), vit: b.vit + v };
}

interface WbSpec {
  cls: HeroClass;
  level: number;
  tier: 1 | 2 | 3;
  stats: Stats;
  weapon: string;
  armor: string;
  refine: number;
}

const TIER_WEAPON: Record<number, Record<HeroClass, string>> = {
  // Ninja = the real dagger line (GEAR wave 2).
  7: { swordsman: "w_sword_t7_frost", archer: "w_bow_t7_frost", mage: "w_staff_t7_frost", ninja: "w_dagger_t7_frost" },
  8: T8_WEAPON,
  9: { swordsman: "w_sword_t9_obsidian", archer: "w_bow_t9_obsidian", mage: "w_staff_t9_obsidian", ninja: "w_dagger_t9_obsidian" },
  10: { swordsman: "w_sword_t10_apocalypse", archer: "w_bow_t10_apocalypse", mage: "w_staff_t10_apocalypse", ninja: "w_dagger_t10_apocalypse" },
};
const TIER_ARMOR: Record<number, Record<HeroClass, string> | string> = {
  7: "a_frost_t7_mail",
  8: T8_ARMOR,
  9: "a_obsidian_t9_scale",
  10: "a_infernal_t10_aegis",
};
/** Era-appropriate gear tier for a party member's level (t7 s16-20 → t10 endgame). */
function eraGearTier(level: number): number {
  return level >= 80 ? 10 : level >= 70 ? 9 : level >= 60 ? 8 : 7;
}
function partySpec(cls: HeroClass, level = WB_LEVEL, refine = WB_REFINE): WbSpec {
  const gt = eraGearTier(level);
  const arm = TIER_ARMOR[gt];
  return {
    cls,
    level,
    tier: level >= 40 ? 3 : level >= 5 ? 2 : 1,
    stats: allocStats(cls, level),
    weapon: TIER_WEAPON[gt][cls],
    armor: typeof arm === "string" ? arm : arm[cls],
    refine,
  };
}

function maxedSpec(cls: HeroClass): WbSpec {
  return {
    cls,
    level: 90,
    tier: 3,
    stats: ISO_STATS[cls],
    weapon: ISO_GEAR[cls].weapon,
    armor: ISO_GEAR[cls].armor,
    refine: 10,
  };
}

function makeWbHero(id: number, sp: WbSpec): Hero {
  return makeHero(
    id,
    sp.cls,
    sp.level,
    0,
    sp.tier,
    (sp.level - 1) * CONFIG.stats.pointsPerLevel,
    sp.stats,
    undefined,
    undefined,
    null,
    { weapon: sp.weapon, armor: sp.armor, refine: { weapon: sp.refine, armor: sp.refine } },
  );
}

interface WbResult {
  killed: boolean;
  killTimeS: number | null;
  deaths: number;
  firstDeathS: number | null;
  /** Boss HP fraction remaining when the run ended (0 = killed, 1 = untouched). */
  hpFracLeft: number;
  /** The run ended because the SOLO hero total-wiped (boss despawned on zone-leave). */
  soloWiped: boolean;
}

/**
 * Run the world-boss fight for a party of specs. `immortal` makes every hero
 * un-killable (huge HP) to measure the raw DPS CEILING (uptime not the bottleneck);
 * otherwise it's the realistic auto-potion run (a solo total-wipe despawns the boss).
 */
function runWorldBoss(specs: WbSpec[], immortal: boolean): WbResult {
  const s = initGameState(WB_SEED, makeSave(specs[0].cls, WB_SEED));
  s.location = { mapId: WB_LOC.mapId, zoneIdx: WB_LOC.zoneIdx };
  s.stage = zoneAt(s.location).stage;
  s.phase = "battle";
  s.unlockedZones = { ...s.unlockedZones, map1: 7 };
  s.lastFarmZone = { mapId: WB_LOC.mapId, zoneIdx: WB_LOC.zoneIdx };
  s.heroes = specs.map((sp, i) => makeWbHero(i + 1, sp));
  s.nextId = specs.length + 1;
  for (const h of s.heroes) {
    configCohortHero(h);
    if (immortal) {
      h.maxHp = 1e9;
      h.hp = 1e9;
    }
  }
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;
  s.consumables = { hpPotion: 999999, manaPotion: 999999, returnScroll: 0, warpScroll: 0 };
  // Freeze the normal mob field so the fight is isolated (matches the engine test's
  // `isolate`): no farm mobs, no burst, no seeded spawn draw.
  s.spawnPaused = true;
  s.spawnBurst = false;
  s.enemies = [];

  const size = specs.length;
  const perDead = s.heroes.map((h) => h.dead);
  let deaths = 0;
  let firstDeathS: number | null = null;
  let killed = false;
  let killTimeS: number | null = null;
  let soloWiped = false;
  const maxSteps = Math.round(WB_LIFETIME_S / FIXED_DT);

  for (let i = 0; i < maxSteps; i++) {
    const lanes: FrameInput[] = s.heroes.map((h) => {
      const lane: FrameInput = {};
      const slots = fillAutoSlots(h);
      if (slots.length) lane.setAutoSlots = slots;
      return lane;
    });
    if (i === 0) lanes[0].spawnWorldBoss = { windowId: WB_WINDOW, remainingSeconds: WB_LIFETIME_S };
    s.spawnPaused = true; // keep the field frozen every step (isolate the boss)
    s.enemies = [];

    step(s, lanes);

    for (const e of s.events) if (e.type === "worldBossDefeated") { killed = true; killTimeS = s.time; }
    for (let k = 0; k < size; k++) {
      const nd = s.heroes[k].dead;
      if (nd && !perDead[k]) {
        deaths++;
        if (firstDeathS === null) firstDeathS = s.time;
      }
      perDead[k] = nd;
    }
    if (killed) break;
    // Boss gone (solo total-wipe despawn, or lifetime expiry) → the run is over.
    if (!s.worldBoss || !s.worldBoss.active || !s.worldBoss.entity) {
      soloWiped = size === 1 && !killed;
      break;
    }
  }

  const wb = s.worldBoss?.entity;
  const hpFracLeft = killed ? 0 : wb ? wb.hp / wb.maxHp : 1;
  return { killed, killTimeS, deaths, firstDeathS, hpFracLeft, soloWiped };
}

const fmtT = (v: number | null): string => (v === null ? "-" : `${(v / 60).toFixed(2)}min (${v.toFixed(0)}s)`);

// ---- Reward-inflation income probe: normal farm gold/hr + stones/hr at a stage. ----
function farmLocForStage(stage: number): WorldLocation {
  for (const m of CONFIG.world.maps) {
    const idx = (m.zoneStageIds as readonly number[]).indexOf(stage);
    if (idx >= 0) {
      const townShift = m.id === CONFIG.world.townMapId ? 1 : 0;
      return { mapId: m.id, zoneIdx: townShift + idx };
    }
  }
  throw new Error(`no farm zone for stage ${stage}`);
}

function measureIncome(sp: WbSpec, stage: number, seconds: number): { goldPerHr: number; stonesPerHr: number } {
  const s = initGameState(WB_SEED, makeSave(sp.cls, WB_SEED));
  const loc = farmLocForStage(stage);
  s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
  s.stage = stage;
  s.phase = "battle";
  s.unlockedZones = { map1: 7, map2: 6, map3: 6, map4: 6, map5: 6, map6: 6 };
  s.lastFarmZone = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
  s.heroes = [makeWbHero(1, sp)];
  s.nextId = 2;
  configCohortHero(s.heroes[0]);
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;
  s.consumables = { hpPotion: 999999, manaPotion: 999999, returnScroll: 0, warpScroll: 0 };
  const gold0 = s.gold;
  let stones = 0;
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const input: FrameInput = {};
    const slots = fillAutoSlots(s.heroes[0]);
    if (slots.length) input.setAutoSlots = slots;
    step(s, input);
    for (const e of s.events) if (e.type === "stoneDrop") stones += e.qty;
  }
  const gold = s.gold - gold0;
  return { goldPerHr: (gold / seconds) * 3600, stonesPerHr: (stones / seconds) * 3600 };
}

const REWARD_GOLD = 5000; // owner-FIXED reward per member per hour
const REWARD_STONES = 350;

function runWorldBossMode(): void {
  applyWorldBossTune();
  console.log(
    `[world-boss "เสี่ยจ๋อง"] lifetime ${WB_LIFETIME_S / 60}min · hp ${WORLD_BOSS.hp.toLocaleString()} · ` +
      `atk ${WORLD_BOSS.atk} · behaviors [${WORLD_BOSS.behaviors.join(",")}] · zone ${WB_LOC.mapId}/z${WB_LOC.zoneIdx} (s${zoneAt(WB_LOC).stage})\n` +
      `party profile: Lv${WB_LEVEL} tier${WB_LEVEL >= 40 ? 3 : 2} t8+${WB_REFINE}\n`,
  );

  // ---- Target 1: SOLO must NOT kill it in the window (even maxed L90 t10+10). ----
  console.log("=== TARGET 1 — SOLO maxed L90 tier-3 t10+10 (must NOT kill in 15min; must SURVIVE) ===");
  console.log("  " + pad("class", 10) + pad("DPS-ceiling(immortal)", 24) + pad("realistic", 34) + "verdict");
  for (const cls of CLASSES) {
    const ceil = runWorldBoss([maxedSpec(cls)], true);
    const real = runWorldBoss([maxedSpec(cls)], false);
    const ceilStr = ceil.killed ? fmtT(ceil.killTimeS) : `SURVIVES (${(100 * (1 - ceil.hpFracLeft)).toFixed(0)}% chunked)`;
    const realStr = real.killed
      ? `KILLED ${fmtT(real.killTimeS)} deaths ${real.deaths}`
      : real.soloWiped
        ? `WIPED @${fmtT(real.firstDeathS)} (${(100 * (1 - real.hpFracLeft)).toFixed(0)}% chunked, ${real.deaths} deaths)`
        : `survived, ${(100 * (1 - real.hpFracLeft)).toFixed(0)}% chunked, ${real.deaths} deaths`;
    const gateHeld = !real.killed;
    console.log("  " + pad(cls, 10) + pad(ceilStr, 24) + pad(realStr, 34) + (gateHeld ? "GATE HELD" : "*** GATE FAIL ***"));
  }

  // ---- Target 2: 2-3p (mixed, Lv50-70) kills in ~3-6min; 6p quantified. ----
  console.log(`\n=== TARGET 2 — party (Lv${WB_LEVEL} tier3, t8+${WB_REFINE}) time-to-kill ===`);
  console.log("  " + pad("comp", 26) + pad("result", 30) + "deaths");
  const comps: { label: string; specs: WbSpec[] }[] = [
    { label: "2p [sword,mage]", specs: [partySpec("swordsman"), partySpec("mage")] },
    { label: "3p [sword,archer,mage]", specs: MIX_CLASSES.map((c) => partySpec(c)) },
    { label: "6p [2×each]", specs: [...MIX_CLASSES, ...MIX_CLASSES].map((c) => partySpec(c)) },
  ];
  for (const comp of comps) {
    const r = runWorldBoss(comp.specs, false);
    const res = r.killed
      ? `KILLED ${fmtT(r.killTimeS)}`
      : r.soloWiped
        ? `WIPED (${(100 * (1 - r.hpFracLeft)).toFixed(0)}% chunked)`
        : `NOT KILLED (${(100 * (1 - r.hpFracLeft)).toFixed(0)}% chunked in 15min)`;
    console.log("  " + pad(comp.label, 26) + pad(res, 30) + String(r.deaths));
  }

  // ---- Target 3: reward-inflation report (rewards owner-FIXED — just quantify). ----
  console.log(`\n=== TARGET 3 — reward inflation: ${REWARD_GOLD} gold + ${REWARD_STONES} stones per member per WINDOW ===`);
  console.log("  (normal farm income measured 600s in-zone at each progression point)");
  console.log("  " + pad("point", 24) + pad("gold/hr", 12) + pad("stones/hr", 12) + pad("gold boost", 14) + "stone boost");
  const points: { label: string; sp: WbSpec; stage: number }[] = [
    { label: "NEWBIE Lv10/map1 s3", sp: { cls: "swordsman", level: 10, tier: 1, stats: allocStats("swordsman", 10), weapon: "w_sword_t2_iron", armor: "a_leather_t2_vest", refine: 0 }, stage: 3 },
    { label: "early Lv20/map2 s8", sp: { cls: "swordsman", level: 20, tier: 2, stats: allocStats("swordsman", 20), weapon: "w_sword_t3_knight", armor: "a_chain_t3_mail", refine: 2 }, stage: 8 },
    { label: "mid Lv50/map4 s18", sp: { cls: "swordsman", level: 50, tier: 3, stats: allocStats("swordsman", 50), weapon: "w_sword_t7_frost", armor: "a_frost_t7_mail", refine: 5 }, stage: 18 },
    { label: "end Lv80/map6 s28", sp: { cls: "swordsman", level: 80, tier: 3, stats: allocStats("swordsman", 80), weapon: "w_sword_t9_obsidian", armor: "a_obsidian_t9_scale", refine: 8 }, stage: 28 },
  ];
  for (const p of points) {
    const inc = measureIncome(p.sp, p.stage, 600);
    const goldBoost = (100 * REWARD_GOLD) / Math.max(1, inc.goldPerHr);
    const stoneBoost = (100 * REWARD_STONES) / Math.max(1, inc.stonesPerHr);
    const flag = goldBoost > 300 ? "  <== LOUD FLAG (>3x)" : "";
    console.log(
      "  " +
        pad(p.label, 24) +
        pad(inc.goldPerHr.toFixed(0), 12) +
        pad(inc.stonesPerHr.toFixed(0), 12) +
        pad(`+${goldBoost.toFixed(0)}%`, 14) +
        `+${stoneBoost.toFixed(0)}%${flag}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ดินแดนอสูร DEPTH-LADDER mode (HARD=1) — endgame v1 first-cut verifier.
// Seats a fixture L~65 tier-3 t10 hero at REFINE +N (sweep REFLVL=8|9|10) at the START of the
// asura map (z1, only z1 unlocked) and farms FORWARD on autopilot (farm-only — never the boss
// room). Each asura zone unlocks the next only when its kill quota is met, so PROGRESS gates on
// SURVIVAL: the owner target is +8 barely survives z1-3, +9 needs it for z4-7, +10 for z8-10,
// below +8 = a wall. Reports deepest zone reached + per-zone deaths + elites/essence/stones so the
// sim wave (4) can finalize the CONFIG.asura depth multipliers. bot potions ON (as the owner spec).
// Env: HARD=1, REFLVL="8,9,10", HARD_LEVEL (65), SEEDS, CLASSES, SIM_SECONDS (raise for depth).
// ---------------------------------------------------------------------------
const HARD_REFLVLS = (process.env.REFLVL ?? "8,9,10")
  .split(",")
  .map((n) => Math.round(Number(n.trim())))
  .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
const HARD_LEVEL = Math.round(Number(process.env.HARD_LEVEL ?? 65));
// HARD_START: seat the fixture at THIS asura depth (0..9) with only that zone onward
// unlocked — band-isolation so a +9 run can be measured directly in z4-7 (start 3) and a
// +10 run in z8-10 (start 7) WITHOUT grinding through the whole ladder. Default 0 = the
// full z1 climb (the organic run).
const HARD_START = Math.max(0, Math.min(CONFIG.asura.farmZones - 1, Math.round(Number(process.env.HARD_START ?? 0))));

function makeAsuraSave(cls: HeroClass, refine: number, level: number, startDepth = 0): SaveData {
  const g = ISO_GEAR[cls]; // t10 endgame gear at the swept refine
  return {
    version: SAVE_VERSION,
    stage: CONFIG.asura.stageBase + startDepth,
    gold: 0,
    goldEarned: 0,
    bossBest: {},
    levelCapAt: null,
    zoneKills: {},
    // Enter at asura z(startDepth+1); ONLY that zone onward is unlocked so each zone must be
    // FARMED (its quota) to open the next — survival gates progress (the depth ladder). map1-6
    // fully unlocked so the s30 gate is moot for the fixture. HARD_START seats a band-isolation
    // run directly at a deeper band (z4-7 / z8-10) to measure it without the full z1 climb.
    location: { mapId: "asura", zoneIdx: startDepth },
    unlockedZones: { map1: 7, map2: 6, map3: 6, map4: 6, map5: 6, map6: 6, asura: startDepth + 1 },
    lastFarmZone: { mapId: "asura", zoneIdx: startDepth },
    consumables: { hpPotion: 99, manaPotion: 99, returnScroll: 3, warpScroll: 0 },
    bot: { enabled: false, sellTripEnabled: false, hpPotionTarget: 15, mpPotionTarget: 15, scrollReserve: 3, goldReserve: 0 },
    autoHunt: true,
    equipped: { weapon: g.weapon, armor: g.armor, refine: { weapon: refine, armor: refine } },
    lootSalt: 1,
    lootCounter: 0,
    materials: 0,
    asuraEssence: 0,
    asuraZoneKills: {},
    hero: {
      cls,
      level,
      xp: 0,
      tier: 3,
      statPoints: 0,
      stats: { ...allocStats(cls, level) },
      mana: 300,
      autoSlots: [SIGNATURE_SKILL[cls], null, null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    },
    lastSeen: 0,
  };
}

/** Farm-only forward autopilot for the asura ladder: walk into the next zone only once it
 *  unlocks AND it is a FARM zone (never challenge the boss-room capstone). */
function asuraNavInput(s: GameState): FrameInput {
  if (s.traveling || s.phase !== "battle") return {};
  const r = worldNav(s).right;
  if (r && r.unlocked && r.zone.kind === "farm") {
    return { walkToZone: { mapId: r.zone.mapId, zoneIdx: r.zone.zoneIdx } };
  }
  return {};
}

interface AsuraDepthStat {
  depth: number;
  stage: number;
  deaths: number;
  cleared: boolean;
  enterTime: number;
  clearTime: number | null; // enter → quota-unlock (s); null = never cleared
  hpPot: number;
  mpPot: number;
  kills: number;
}

interface AsuraResult {
  cls: HeroClass;
  refine: number;
  seed: number;
  deepest: number;
  totalDeaths: number;
  perDepth: AsuraDepthStat[];
  elites: number;
  essence: number;
  stones: number;
  finalLevel: number;
  xpEarned: number;
  goldEarned: number;
}

function runAsuraSeed(cls: HeroClass, seed: number, refine: number): AsuraResult {
  const s = initGameState(seed, makeAsuraSave(cls, refine, HARD_LEVEL, HARD_START));
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;
  s.consumables = { hpPotion: 999999, manaPotion: 999999, returnScroll: 3, warpScroll: 0 };

  const perDepth = new Map<number, AsuraDepthStat>();
  const ensure = (depth: number): AsuraDepthStat => {
    let st = perDepth.get(depth);
    if (!st) {
      st = {
        depth, stage: CONFIG.asura.stageBase + depth, deaths: 0, cleared: false,
        enterTime: s.time, clearTime: null, hpPot: 0, mpPot: 0, kills: 0,
      };
      perDepth.set(depth, st);
    }
    return st;
  };
  let curDepth = HARD_START;
  ensure(HARD_START);
  let deepest = HARD_START;
  let elites = 0;
  let stones = 0;
  const xpStart = totalXpOf(s.heroes[0]);
  const goldStart = s.gold;
  let prevDead = s.heroes[0].dead;

  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = { ...asuraNavInput(s) };
    const slots = fillAutoSlots(s.heroes[0]);
    if (slots.length) input.setAutoSlots = slots;
    step(s, input);
    for (const e of s.events) {
      if (e.type === "zoneEntered" && e.mapId === "asura" && e.kind === "farm") {
        curDepth = e.zoneIdx;
        const st = ensure(curDepth);
        if (st.enterTime === 0 || st.kills === 0) st.enterTime = s.time; // first real entry
        if (curDepth > deepest) deepest = curDepth;
      }
      if (e.type === "zoneUnlocked" && e.mapId === "asura") {
        // The zone we're standing in just cleared its quota → mark it cleared (once).
        const cur = s.location.mapId === "asura" ? s.location.zoneIdx : curDepth;
        const st = ensure(cur);
        if (!st.cleared) { st.cleared = true; st.clearTime = s.time - st.enterTime; }
      }
      if (e.type === "kill") ensure(curDepth).kills++;
      if (e.type === "consumableUsed") {
        if (e.item === "hpPotion") ensure(curDepth).hpPot++;
        else if (e.item === "manaPotion") ensure(curDepth).mpPot++;
      }
      if (e.type === "eliteKilled") elites++;
      if (e.type === "stoneDrop") stones += e.qty;
    }
    const nowDead = s.heroes[0].dead;
    if (nowDead && !prevDead && s.location.mapId === "asura") ensure(curDepth).deaths++;
    prevDead = nowDead;
  }

  const totalDeaths = [...perDepth.values()].reduce((a, d) => a + d.deaths, 0);
  return {
    cls,
    refine,
    seed,
    deepest,
    totalDeaths,
    perDepth: [...perDepth.values()].sort((a, b) => a.depth - b.depth),
    elites,
    essence: s.asuraEssence,
    stones,
    finalLevel: s.heroes[0].level,
    xpEarned: totalXpOf(s.heroes[0]) - xpStart,
    goldEarned: s.gold - goldStart,
  };
}

function runAsuraHard(): void {
  console.log(
    `[ดินแดนอสูร HARD] depth-ladder first cut — L${HARD_LEVEL} tier-3 t10 gear, refine sweep ` +
      `[${HARD_REFLVLS.join(",")}] · ${SIM_SECONDS}s × ${SEEDS.length} seeds · classes ${CLASSES.join("/")}\n` +
      `  owner gate: +8 barely survives z1-3 · +9 needed z4-7 · +10 needed z8-10 · <+8 = wall\n` +
      `  hp mult/zone:  ${CONFIG.asura.hpMultByDepth.map((m, i) => `z${i + 1}:${m}`).join(" ")}\n` +
      `  atk mult/zone: ${CONFIG.asura.atkMultByDepth.map((m, i) => `z${i + 1}:${m}`).join(" ")}`,
  );
  if (HARD_START > 0) console.log(`  BAND-ISOLATION: seated at z${HARD_START + 1} (only z${HARD_START + 1}+ unlocked)`);
  for (const cls of CLASSES) {
    console.log(`\n=== ${cls.toUpperCase()} ===`);
    console.log(
      "  " + pad("refine", 8) + pad("deepest", 9) + pad("deaths", 8) +
        pad("elites", 8) + pad("essence", 9) + pad("stones", 8) + "per-zone (z1..z10; * = cleared)",
    );
    // deaths/100-kills normalizes out killGoal so survivability is the signal, not grind volume.
    const perZoneRow = (
      pick: (x: AsuraDepthStat) => number,
      fmt: (v: number, cleared: boolean, seen: boolean) => string,
    ) => (results: AsuraResult[]): string[] => {
      const cells: string[] = [];
      for (let d = 0; d < CONFIG.asura.farmZones; d++) {
        const ds = results.map((r) => r.perDepth.find((p) => p.depth === d));
        const seen = ds.some((x) => x !== undefined);
        if (!seen) { cells.push("-"); continue; }
        const v = mean(ds.filter((x): x is AsuraDepthStat => !!x).map(pick));
        cells.push(fmt(v, ds.some((x) => x?.cleared), seen));
      }
      return cells;
    };
    for (const refine of HARD_REFLVLS) {
      const results = SEEDS.map((seed) => runAsuraSeed(cls, seed, refine));
      const deepest = mean(results.map((r) => r.deepest + 1)); // 1-based zone reached
      const deaths = mean(results.map((r) => r.totalDeaths));
      const elites = mean(results.map((r) => r.elites));
      const essence = mean(results.map((r) => r.essence));
      const stones = mean(results.map((r) => r.stones));
      const deathCells = perZoneRow((x) => x.deaths, (v, c) => `${v.toFixed(0)}${c ? "*" : ""}`)(results);
      // deaths per 100 kills — the killGoal-independent survivability signal.
      const dphkCells = perZoneRow(
        (x) => (x.kills > 0 ? (100 * x.deaths) / x.kills : 0),
        (v) => v.toFixed(1),
      )(results);
      const clrCells = perZoneRow((x) => x.clearTime ?? NaN, (v) => (Number.isNaN(v) ? "·" : v.toFixed(0)))(results);
      const potCells = perZoneRow((x) => x.hpPot, (v) => v.toFixed(0))(results);
      console.log(
        "  " + pad(`+${refine}`, 8) + pad(deepest.toFixed(1), 9) + pad(deaths.toFixed(0), 8) +
          pad(elites.toFixed(0), 8) + pad(essence.toFixed(0), 9) + pad(stones.toFixed(0), 8) +
          deathCells.join(" "),
      );
      console.log("  " + pad("", 50) + "d/100kill: " + dphkCells.join(" "));
      console.log("  " + pad("", 50) + "clear s:   " + clrCells.join(" "));
      console.log("  " + pad("", 50) + "hpPot:     " + potCells.join(" "));
      // Income + runway: xp/hr → days of ACTIVE farming to reach L90 from the fixture level.
      const xpHr = mean(results.map((r) => r.xpEarned)) / HOURS;
      const goldHr = mean(results.map((r) => r.goldEarned)) / HOURS;
      const finalLvl = mean(results.map((r) => r.finalLevel));
      let xpTo90 = 0;
      for (let l = HARD_LEVEL; l < 90; l++) xpTo90 += CONFIG.leveling.xpToLevel(l);
      const daysTo90 = xpHr > 0 ? xpTo90 / xpHr / 24 : Infinity;
      console.log(
        "  " + pad("", 50) +
          `income: xp/hr ${xpHr.toFixed(0)}  gold/hr ${goldHr.toFixed(0)}  finalLvl ${finalLvl.toFixed(1)}  ` +
          `→ L${HARD_LEVEL}→90 ≈ ${daysTo90.toFixed(1)} active-days`,
      );
    }
  }
}

function main(): void {
  if (process.env.HARD === "1") {
    runAsuraHard();
    return;
  }
  if (process.env.WORLDBOSS === "1") {
    runWorldBossMode();
    return;
  }
  if (process.env.BOSSISO === "1") {
    runBossIso();
    return;
  }
  if (PARTY >= 2 || PARTY_MIX) {
    runParty();
    return;
  }
  if (REFINE_SWEEP) {
    runSweep();
    return;
  }
  console.log(
    `[balance-sim ${GEAR ? "M7 GEAR" : "M6 world / M7 no-gear"}${REFINE_ON ? " +REFINE" : ""}] ${SIM_SECONDS}s ` +
      `(${STEPS} steps) per seed, ${SEEDS.length} seeds, classes: ${CLASSES.join("/")}`,
  );
  const byClass = new Map<HeroClass, ZoneAgg[]>();
  for (const cls of CLASSES) {
    const results = SEEDS.map((seed) => runSeed(cls, seed));
    const agg = aggregate(results);
    byClass.set(cls, agg);
    printClass(cls, results, agg);
  }

  // Cross-class farm-zone clear time per stage (pacing comparison).
  console.log(`\n=== FARM-ZONE clear time per stage (mean s) ===`);
  const stages = [...new Set([...byClass.values()].flatMap((a) => a.filter((z) => z.kind === "farm").map((z) => z.stage)))].sort((a, b) => a - b);
  console.log("  " + pad("stage", 6) + CLASSES.map((c) => pad(c, 11)).join(""));
  for (const stage of stages) {
    const row = CLASSES.map((c) => {
      const z = byClass.get(c)?.find((x) => x.stage === stage && x.kind === "farm");
      return pad(z?.meanDur == null ? "-" : z.meanDur.toFixed(0) + "s", 11);
    });
    console.log("  " + pad(stage, 6) + row.join(""));
  }
}

main();
