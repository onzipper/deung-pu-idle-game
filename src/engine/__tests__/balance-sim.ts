/**
 * Balance-simulation harness (headless) — M5 SOLO rebaseline tool.
 *
 * M5 Character Pivot: the game is now a SINGLE character, not a 3-hero team, and
 * the purchasable upgrade lines are gone. This harness runs the pure engine with
 * no renderer and an auto-pilot for EACH base class SOLO (swordsman / archer /
 * mage), instruments the run, and reports per-class per-stage pacing so solo
 * viability (S1->S10, 0 permanent walls, classes within ~2x) can be verified.
 *
 * Auto-pilot: auto-cast on, challenge the boss as soon as the hint says "ready",
 * advance on victory, and auto-evolve the moment the level+gold gate is met (the
 * only gold sink left). Everything is derived purely from `step()` + read-only
 * helpers, so results are deterministic and reproducible.
 *
 * Run with: `pnpm sim`
 * Knobs (env):
 *   SIM_SECONDS=1800    simulated seconds per seed
 *   SEEDS=1,2,3,42,1337 comma-separated RNG seeds
 *   CLASSES=swordsman,archer,mage  which classes to run
 */

import {
  initGameState,
  step,
  bossHint,
  canEvolveHero,
  evolutionCost,
  CONFIG,
  SAVE_VERSION,
  FIXED_DT,
  type FrameInput,
  type HeroClass,
  type SaveData,
} from "@/engine";

// ---------------------------------------------------------------------------
// Config / knobs
// ---------------------------------------------------------------------------

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
// Per-run metric shapes
// ---------------------------------------------------------------------------

interface StageMetric {
  stage: number;
  enterTime: number;
  clearTime: number | null; // null if the window ended before the boss died
  kills: number;
  income: number; // gold earned during the stage (kills + boss, gross of spend)
  bossAttempts: number;
  bossWipes: number;
  soloDeaths: number; // solo respawns during the stage (anti-stall signal)
  levelAtClear: number; // hero level when the stage cleared
  tierAtClear: 1 | 2;
  recPowerAtWin: number | null;
  teamPowerAtWin: number | null;
}

interface SeedResult {
  cls: HeroClass;
  seed: number;
  finalStage: number;
  finalGold: number;
  finalLevel: number;
  firstBossKillTime: number | null;
  totalWipes: number;
  totalDeaths: number;
  stages: StageMetric[];
}

// ---------------------------------------------------------------------------
// One seeded solo run, fully instrumented
// ---------------------------------------------------------------------------

function makeSave(cls: HeroClass): SaveData {
  return {
    version: SAVE_VERSION,
    stage: 1,
    gold: 0,
    hero: { cls, level: 1, xp: 0, tier: 1, statPoints: 0, stats: { ...CONFIG.stats.base[cls] } },
    lastSeen: 0,
  };
}

function runSeed(cls: HeroClass, seed: number): SeedResult {
  const s = initGameState(seed, makeSave(cls));
  s.autoCast = true;
  // M5 "Base stats": measure the AUTO-allocated baseline (idle player) — every
  // level's points dump into the class primary stat each step.
  s.autoAllocate = true;

  const stages: StageMetric[] = [];
  let cur: StageMetric = freshStage(s.stage, 0);

  let prevPhase = s.phase;
  let prevStage = s.stage;
  let prevGold = s.gold;
  let prevTier = s.heroes[0].tier;
  let prevKills = s.kills;
  let prevDead = s.heroes[0].dead;

  let firstBossKillTime: number | null = null;
  let totalWipes = 0;
  let totalDeaths = 0;
  let pendingRec: number | null = null;
  let pendingTeam: number | null = null;
  // Realistic retry loop: challenge the boss once the kill goal is met, then —
  // if it wipes and retreats — FARM at least one more level before re-attempting
  // (a real player grinds between boss tries). This removes the raw-atk hint bias
  // that made low-atk-but-high-DPS classes over-farm, so the sim measures actual
  // combat balance. `null` = never attempted this stage yet.
  let lastAttemptLevel: number | null = null;
  let lastAttemptStage = 0;

  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = {};
    if (s.phase === "battle" && s.bossReady) {
      if (lastAttemptStage !== s.stage) lastAttemptLevel = null; // fresh stage
      const lvl = s.heroes[0].level;
      if (lastAttemptLevel === null || lvl > lastAttemptLevel) {
        input.challengeBoss = true;
        lastAttemptLevel = lvl;
        lastAttemptStage = s.stage;
        const hint = bossHint(s);
        pendingRec = hint.recommendedPower;
        pendingTeam = hint.teamPower;
      }
    } else if (s.phase === "victory") {
      input.advanceStage = true;
    }

    // Auto-evolve (M5): the player evolves as soon as the level+gold gate is met.
    if (canEvolveHero(s, s.heroes[0])) input.evolveHero = 0;

    step(s, input);

    // --- gold spend (evolution is the only sink now) ---
    let spend = 0;
    if (prevTier < s.heroes[0].tier) spend += evolutionCost(s.heroes[0].cls);

    const income = s.gold - prevGold + spend;
    if (income > 0) cur.income += income;

    // --- solo respawn detection (dead edge) ---
    const nowDead = s.heroes[0].dead;
    if (nowDead && !prevDead && s.phase === "battle") {
      cur.soloDeaths++;
      totalDeaths++;
    }

    // --- phase transitions ---
    if (prevPhase !== s.phase) {
      if (prevPhase === "battle" && s.phase === "boss") {
        cur.bossAttempts++;
      } else if (prevPhase === "boss" && s.phase === "battle") {
        cur.bossWipes++;
        totalWipes++;
      } else if (prevPhase === "boss" && s.phase === "victory") {
        cur.clearTime = s.time;
        cur.kills = prevKills;
        cur.levelAtClear = s.heroes[0].level;
        cur.tierAtClear = s.heroes[0].tier;
        cur.recPowerAtWin = pendingRec;
        cur.teamPowerAtWin = pendingTeam;
        if (firstBossKillTime === null) firstBossKillTime = s.time;
        stages.push(cur);
      }
    }

    if (s.stage !== prevStage) {
      cur = freshStage(s.stage, s.time);
    }

    prevPhase = s.phase;
    prevStage = s.stage;
    prevGold = s.gold;
    prevTier = s.heroes[0].tier;
    prevKills = s.kills;
    prevDead = nowDead;
  }

  if (cur.clearTime === null) {
    cur.kills = s.kills;
    cur.levelAtClear = s.heroes[0].level;
    cur.tierAtClear = s.heroes[0].tier;
    stages.push(cur);
  }

  return {
    cls,
    seed,
    finalStage: s.stage,
    finalGold: Math.floor(s.gold),
    finalLevel: s.heroes[0].level,
    firstBossKillTime,
    totalWipes,
    totalDeaths,
    stages,
  };
}

function freshStage(stage: number, enterTime: number): StageMetric {
  return {
    stage,
    enterTime,
    clearTime: null,
    kills: 0,
    income: 0,
    bossAttempts: 0,
    bossWipes: 0,
    soloDeaths: 0,
    levelAtClear: 1,
    tierAtClear: 1,
    recPowerAtWin: null,
    teamPowerAtWin: null,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const pad = (v: unknown, w: number): string => String(v).padEnd(w);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

interface StageAgg {
  stage: number;
  clears: number;
  meanDur: number | null;
  meanLevel: number | null;
  totalAttempts: number;
  totalWipes: number;
  totalDeaths: number;
  meanRec: number | null;
  meanTeam: number | null;
}

function aggregate(results: SeedResult[]): StageAgg[] {
  const maxStage = Math.max(...results.map((r) => r.finalStage));
  const out: StageAgg[] = [];
  for (let stage = 1; stage <= maxStage; stage++) {
    const all = results.flatMap((r) => r.stages).filter((st) => st.stage === stage);
    const cleared = all.filter((st) => st.clearTime !== null);
    const durs = cleared.map((st) => st.clearTime! - st.enterTime);
    const levels = cleared.map((st) => st.levelAtClear);
    const recs = cleared.map((st) => st.recPowerAtWin).filter((x): x is number => x !== null);
    const teams = cleared.map((st) => st.teamPowerAtWin).filter((x): x is number => x !== null);
    out.push({
      stage,
      clears: cleared.length,
      meanDur: durs.length ? mean(durs) : null,
      meanLevel: levels.length ? mean(levels) : null,
      totalAttempts: all.reduce((a, st) => a + st.bossAttempts, 0),
      totalWipes: all.reduce((a, st) => a + st.bossWipes, 0),
      totalDeaths: all.reduce((a, st) => a + st.soloDeaths, 0),
      meanRec: recs.length ? mean(recs) : null,
      meanTeam: teams.length ? mean(teams) : null,
    });
  }
  return out;
}

function printClass(cls: HeroClass, results: SeedResult[], agg: StageAgg[]): void {
  const nSeeds = results.length;
  console.log(`\n=== ${cls.toUpperCase()} (solo) — ${nSeeds} seeds ===`);
  console.log(
    "  " +
      pad("stage", 6) +
      pad("clears", 8) +
      pad("meanDur", 9) +
      pad("wallX", 7) +
      pad("lvl", 6) +
      pad("boss a/w", 10) +
      pad("deaths", 8) +
      pad("rec:team", 12),
  );
  let prevDur: number | null = null;
  for (const a of agg) {
    const wallX = prevDur && a.meanDur ? (a.meanDur / prevDur).toFixed(2) + "x" : "-";
    console.log(
      "  " +
        pad(a.stage, 6) +
        pad(`${a.clears}/${nSeeds}`, 8) +
        pad(a.meanDur === null ? "-" : a.meanDur.toFixed(1), 9) +
        pad(wallX, 7) +
        pad(a.meanLevel === null ? "-" : a.meanLevel.toFixed(0), 6) +
        pad(`${a.totalAttempts}/${a.totalWipes}`, 10) +
        pad(a.totalDeaths, 8) +
        pad(
          a.meanRec === null ? "-" : `${Math.round(a.meanRec)}:${Math.round(a.meanTeam ?? 0)}`,
          12,
        ),
    );
    if (a.meanDur !== null) prevDur = a.meanDur;
  }

  // Flags.
  const flags: string[] = [];
  for (const a of agg) {
    if (a.clears < nSeeds) {
      flags.push(
        `WALL/STALL at stage ${a.stage}: only ${a.clears}/${nSeeds} seeds cleared it in the window`,
      );
    }
  }
  let pd: number | null = null;
  for (const a of agg) {
    if (a.meanDur !== null && pd !== null && a.meanDur > pd * 2.5) {
      flags.push(`SPIKE at stage ${a.stage}: ${(a.meanDur / pd).toFixed(2)}x prev`);
    }
    if (a.meanDur !== null) pd = a.meanDur;
  }
  const totalDeaths = results.reduce((x, r) => x + r.totalDeaths, 0);
  const totalWipes = results.reduce((x, r) => x + r.totalWipes, 0);
  flags.push(
    `reached stages: ${results.map((r) => r.finalStage).join(",")} | ` +
      `final levels: ${results.map((r) => r.finalLevel).join(",")} | ` +
      `solo respawns: ${totalDeaths} | boss wipes: ${totalWipes}`,
  );
  for (const line of flags) console.log("  - " + line);
}

// ---------------------------------------------------------------------------
// Cross-class comparison
// ---------------------------------------------------------------------------

function printComparison(byClass: Map<HeroClass, StageAgg[]>): void {
  console.log(`\n=== CLASS BALANCE (mean time-to-clear per stage) ===`);
  const maxStage = Math.max(
    ...[...byClass.values()].map((agg) => agg.length),
    0,
  );
  const header = "  " + pad("stage", 6) + CLASSES.map((c) => pad(c, 11)).join("") + "spread";
  console.log(header);
  for (let stage = 1; stage <= maxStage; stage++) {
    const durs = CLASSES.map((c) => {
      const a = byClass.get(c)?.find((x) => x.stage === stage);
      return a?.meanDur ?? null;
    });
    const present = durs.filter((d): d is number => d !== null);
    const spread =
      present.length >= 2 ? (Math.max(...present) / Math.min(...present)).toFixed(2) + "x" : "-";
    console.log(
      "  " +
        pad(stage, 6) +
        durs.map((d) => pad(d === null ? "-" : d.toFixed(0) + "s", 11)).join("") +
        spread,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main(): void {
  console.log(
    `[balance-sim M5 solo] ${SIM_SECONDS}s (${STEPS} steps) per seed, ` +
      `${SEEDS.length} seeds, classes: ${CLASSES.join("/")}`,
  );
  const byClass = new Map<HeroClass, StageAgg[]>();
  for (const cls of CLASSES) {
    const results = SEEDS.map((seed) => runSeed(cls, seed));
    const agg = aggregate(results);
    byClass.set(cls, agg);
    printClass(cls, results, agg);
  }
  printComparison(byClass);
}

main();
