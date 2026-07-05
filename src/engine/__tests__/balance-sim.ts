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
  initGameState,
  step,
  canEvolveHero,
  isClassChangeQuestOffered,
  learnedSkills,
  unlockedAutoSlotCount,
  worldNav,
  zoneAt,
  SIGNATURE_SKILL,
  FIXED_DT,
  type FrameInput,
  type Hero,
  type GameState,
  type HeroClass,
  type SaveData,
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
  .filter((s): s is HeroClass => s === "swordsman" || s === "archer" || s === "mage");

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
  totalDeaths: number;
  totalWipes: number;
  zones: ZoneMetric[];
}

function makeSave(cls: HeroClass): SaveData {
  // A cold-start save at stage 1 (first farm zone). Built directly; the world
  // fields are what initGameState fills for a fresh start, mirrored here.
  return {
    version: 8,
    stage: 1,
    gold: 0,
    location: { mapId: "map1", zoneIdx: 1 },
    unlockedZones: { map1: 2 },
    lastFarmZone: { mapId: "map1", zoneIdx: 1 },
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
      : { str: 3, dex: 4, int: 8, vit: 4 };
}

/** Idle-player auto-slot fill (unchanged from the M5 harness). */
function fillAutoSlots(hero: Hero): { slot: number; skillId: string | null }[] {
  const unlocked = unlockedAutoSlotCount(hero.level);
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

/**
 * World navigation autopilot: walk forward once the current farm zone's quota is
 * met (bossReady) and the next zone is unlocked, enter the boss room, and walk to
 * the next map on a boss-room victory. Between failed boss-room attempts the death
 * -> town -> auto-return loop farms the last zone, so a real "grind + retry" cadence
 * emerges without special-casing it here.
 */
function navInput(s: GameState): Partial<FrameInput> {
  if (s.traveling) return {};
  const nav = worldNav(s);
  const walkRight = (): Partial<FrameInput> =>
    nav.right?.unlocked
      ? { walkToZone: { mapId: nav.right.zone.mapId, zoneIdx: nav.right.zone.zoneIdx } }
      : {};
  if (s.phase === "victory") return walkRight();
  const kind = nav.current.kind;
  if (kind === "town") return walkRight();
  if (kind === "boss") return {};
  if (s.bossReady) return walkRight();
  return {};
}

function runSeed(cls: HeroClass, seed: number): SeedResult {
  const s = initGameState(seed, makeSave(cls));
  s.autoCast = true;
  s.autoAllocate = true;
  s.autoReturn = true;

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
  let totalDeaths = 0;
  let totalWipes = 0;

  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = { ...navInput(s) };
    if (isClassChangeQuestOffered(s.heroes[0])) input.acceptQuest = 0;
    if (canEvolveHero(s, s.heroes[0])) input.evolveHero = 0;
    const slots = fillAutoSlots(s.heroes[0]);
    if (slots.length) input.setAutoSlots = slots;

    step(s, input);

    // Zone clear signals (from events, deterministic).
    for (const e of s.events) {
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
        if (zm && (e.kind === "farm" || e.kind === "boss")) cur = zm;
      }
    }

    // Death edge.
    const nowDead = s.heroes[0].dead;
    if (nowDead && !prevDead) {
      cur.deaths++;
      totalDeaths++;
    }
    // Boss-room attempt / wipe edges.
    if (prevPhase !== s.phase) {
      if (s.phase === "boss") cur.bossAttempts++;
      if (prevPhase === "boss" && s.phase !== "victory") {
        cur.bossWipes++;
        totalWipes++;
      }
    }
    if (prevTier < s.heroes[0].tier) evolveStage = s.stage;

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
    totalDeaths,
    totalWipes,
    zones,
  };
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
      `class-change stage: ${results.map((r) => r.evolveStage ?? "-").join(",")} | ` +
      `deaths: ${results.reduce((a, r) => a + r.totalDeaths, 0)} | ` +
      `boss wipes: ${results.reduce((a, r) => a + r.totalWipes, 0)}`,
  );
  // Frontier flag: which zones did NOT clear on every seed (a wall/soft-wall).
  const walls = agg.filter((a) => a.clears < n).map((a) => `${a.mapId}/s${a.stage}(${a.kind})`);
  if (walls.length) console.log(`  - not cleared on every seed (frontier): ${walls.join(", ")}`);
}

function main(): void {
  console.log(
    `[balance-sim M6 world] ${SIM_SECONDS}s (${STEPS} steps) per seed, ` +
      `${SEEDS.length} seeds, classes: ${CLASSES.join("/")}`,
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
