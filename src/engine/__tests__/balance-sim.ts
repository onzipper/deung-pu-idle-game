/**
 * Balance-simulation harness (headless) — M4 measurement tool.
 *
 * Runs the pure engine with no renderer and an auto-pilot (auto-upgrade +
 * auto-cast, challenge the boss as soon as the hint says "ready", advance on
 * victory) and instruments the run to produce pacing metrics:
 *
 *   - time-to-clear per stage (enter-stage -> boss defeated)
 *   - gold income rate per stage (kills + boss payouts, net of upgrade spend)
 *   - boss attempts / wins / retreat-loops (wipes) per stage
 *   - upgrade levels (atk / speed / hp) at each stage clear
 *   - first-upgrade time and first-boss-kill time (early-game hook)
 *   - boss-hint accuracy: recommended vs actual team power at the winning attempt
 *
 * Everything is derived purely from `step()` + read-only helpers (`bossHint`,
 * `upgradeCost`, `CONFIG.*`), so results are deterministic and reproducible.
 *
 * Run with: `pnpm sim`
 * Knobs (env):
 *   SIM_SECONDS=1800   simulated seconds per seed
 *   SEEDS=1,2,3,42,1337 comma-separated RNG seeds
 */

import {
  initGameState,
  step,
  bossHint,
  upgradeCost,
  FIXED_DT,
  type FrameInput,
  type Upgrades,
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

// ---------------------------------------------------------------------------
// Per-run metric shapes
// ---------------------------------------------------------------------------

interface StageMetric {
  stage: number;
  enterTime: number;
  clearTime: number | null; // null if the window ended before the boss died
  kills: number; // kills banked in the stage at clear (or at window end)
  income: number; // gold earned during the stage (kills + boss, gross of spend)
  bossAttempts: number; // challenges started
  bossWipes: number; // boss retreats (team wiped)
  upAtClear: Upgrades; // upgrade levels when the stage cleared
  // hint accuracy, captured at the WINNING challenge:
  recPowerAtWin: number | null;
  teamPowerAtWin: number | null;
}

interface SeedResult {
  seed: number;
  finalStage: number;
  finalGold: number;
  firstUpgradeTime: number | null;
  firstBossKillTime: number | null;
  totalWipes: number;
  stages: StageMetric[];
  finalUpgrades: Upgrades;
}

// ---------------------------------------------------------------------------
// One seeded run, fully instrumented
// ---------------------------------------------------------------------------

function runSeed(seed: number): SeedResult {
  const s = initGameState(seed);
  s.autoUpgrade = true;
  s.autoCast = true;

  const stages: StageMetric[] = [];
  let cur: StageMetric = freshStage(s.stage, 0);

  let prevPhase = s.phase;
  let prevStage = s.stage;
  let prevGold = s.gold;
  let prevUp: Upgrades = { ...s.upgrades };
  let prevKills = s.kills;

  let firstUpgradeTime: number | null = null;
  let firstBossKillTime: number | null = null;
  let totalWipes = 0;
  // hint captured at the moment we press "challenge" this attempt
  let pendingRec: number | null = null;
  let pendingTeam: number | null = null;

  for (let i = 0; i < STEPS; i++) {
    const input: FrameInput = {};
    const hint = s.phase === "battle" && s.bossReady ? bossHint(s) : null;
    if (hint && hint.ready) {
      input.challengeBoss = true;
      pendingRec = hint.recommendedPower;
      pendingTeam = hint.teamPower;
    } else if (s.phase === "victory") {
      input.advanceStage = true;
    }

    step(s, input);

    // --- upgrade spend + first-upgrade detection ---
    let spend = 0;
    for (const line of ["atk", "speed", "hp"] as const) {
      const gained = s.upgrades[line] - prevUp[line];
      for (let g = 0; g < gained; g++) {
        spend += upgradeCost(line, prevUp[line] + g);
      }
      if (gained > 0 && firstUpgradeTime === null) firstUpgradeTime = s.time;
    }

    // --- income this step: gold_new = gold_old + income - spend  =>
    //     income = (gold_new - gold_old) + spend  (exact, no double count) ---
    const income = s.gold - prevGold + spend;
    if (income > 0) cur.income += income;

    // --- phase transitions ---
    if (prevPhase !== s.phase) {
      if (prevPhase === "battle" && s.phase === "boss") {
        cur.bossAttempts++;
      } else if (prevPhase === "boss" && s.phase === "battle") {
        cur.bossWipes++;
        totalWipes++;
      } else if (prevPhase === "boss" && s.phase === "victory") {
        // boss defeated -> record the clear on the CURRENT stage
        cur.clearTime = s.time;
        cur.kills = prevKills; // kills at the moment the boss died
        cur.upAtClear = { ...s.upgrades };
        cur.recPowerAtWin = pendingRec;
        cur.teamPowerAtWin = pendingTeam;
        if (firstBossKillTime === null) firstBossKillTime = s.time;
        stages.push(cur);
      }
    }

    // --- stage advance (victory -> battle at stage+1) ---
    if (s.stage !== prevStage) {
      cur = freshStage(s.stage, s.time);
    }

    prevPhase = s.phase;
    prevStage = s.stage;
    prevGold = s.gold;
    prevUp = { ...s.upgrades };
    prevKills = s.kills;
  }

  // The stage in progress at window-end (never cleared) — record partial.
  if (cur.clearTime === null) {
    cur.kills = s.kills;
    cur.upAtClear = { ...s.upgrades };
    stages.push(cur);
  }

  return {
    seed,
    finalStage: s.stage,
    finalGold: Math.floor(s.gold),
    firstUpgradeTime,
    firstBossKillTime,
    totalWipes,
    stages,
    finalUpgrades: { ...s.upgrades },
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
    upAtClear: { atk: 0, speed: 0, hp: 0 },
    recPowerAtWin: null,
    teamPowerAtWin: null,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const f1 = (n: number | null): string => (n === null ? "  -  " : n.toFixed(1));
const pad = (v: unknown, w: number): string => String(v).padEnd(w);

function printSeed(r: SeedResult): void {
  console.log(
    `\nseed ${r.seed}  ->  reached stage ${r.finalStage}, ${Math.floor(
      r.finalGold,
    )} gold, ${r.totalWipes} wipes` +
      `  | first upgrade @ ${f1(r.firstUpgradeTime)}s, first boss kill @ ${f1(
        r.firstBossKillTime,
      )}s`,
  );
  console.log(
    "  " +
      pad("stage", 6) +
      pad("clear@s", 9) +
      pad("dur", 8) +
      pad("gold/min", 9) +
      pad("kills", 6) +
      pad("atk/spd/hp", 12) +
      pad("boss a/w", 9) +
      pad("hint rec:team", 14),
  );
  for (const st of r.stages) {
    const dur = st.clearTime === null ? null : st.clearTime - st.enterTime;
    const gpm = dur && dur > 0 ? (st.income / dur) * 60 : null;
    const wins = st.clearTime === null ? 0 : 1;
    console.log(
      "  " +
        pad(st.stage, 6) +
        pad(st.clearTime === null ? "(open)" : st.clearTime.toFixed(1), 9) +
        pad(dur === null ? "-" : dur.toFixed(1), 8) +
        pad(gpm === null ? "-" : Math.round(gpm), 9) +
        pad(st.kills, 6) +
        pad(`${st.upAtClear.atk}/${st.upAtClear.speed}/${st.upAtClear.hp}`, 12) +
        pad(`${st.bossAttempts}/${wins}`, 9) +
        pad(
          st.recPowerAtWin === null ? "-" : `${st.recPowerAtWin}:${st.teamPowerAtWin}`,
          14,
        ),
    );
  }
}

// ---------------------------------------------------------------------------
// Aggregation across seeds
// ---------------------------------------------------------------------------

interface StageAgg {
  stage: number;
  clears: number; // how many seeds cleared this stage
  meanDur: number | null; // mean time-to-clear (cleared seeds only)
  meanGpm: number | null; // mean gold/min
  totalAttempts: number;
  totalWipes: number;
  meanRec: number | null;
  meanTeam: number | null;
}

function aggregate(results: SeedResult[]): StageAgg[] {
  const maxStage = Math.max(...results.map((r) => r.finalStage));
  const out: StageAgg[] = [];
  for (let stage = 1; stage <= maxStage; stage++) {
    const cleared = results
      .flatMap((r) => r.stages)
      .filter((st) => st.stage === stage && st.clearTime !== null);
    const attempted = results.flatMap((r) => r.stages).filter((st) => st.stage === stage);
    const durs = cleared.map((st) => st.clearTime! - st.enterTime);
    const gpms = cleared
      .map((st) => {
        const dur = st.clearTime! - st.enterTime;
        return dur > 0 ? (st.income / dur) * 60 : 0;
      })
      .filter((x) => x > 0);
    const recs = cleared
      .map((st) => st.recPowerAtWin)
      .filter((x): x is number => x !== null);
    const teams = cleared
      .map((st) => st.teamPowerAtWin)
      .filter((x): x is number => x !== null);
    out.push({
      stage,
      clears: cleared.length,
      meanDur: durs.length ? mean(durs) : null,
      meanGpm: gpms.length ? mean(gpms) : null,
      totalAttempts: attempted.reduce((a, st) => a + st.bossAttempts, 0),
      totalWipes: attempted.reduce((a, st) => a + st.bossWipes, 0),
      meanRec: recs.length ? mean(recs) : null,
      meanTeam: teams.length ? mean(teams) : null,
    });
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function printAggregate(agg: StageAgg[], nSeeds: number): void {
  console.log(`\n=== AGGREGATE across ${nSeeds} seeds ===`);
  console.log(
    "  " +
      pad("stage", 6) +
      pad("clears", 8) +
      pad("meanDur", 9) +
      pad("wallX", 7) +
      pad("gold/min", 9) +
      pad("attempts", 10) +
      pad("wipes", 7) +
      pad("rec:team", 12),
  );
  let prevDur: number | null = null;
  for (const a of agg) {
    // "wallX" = this stage's mean duration / previous stage's (a >2.5x is a wall)
    const wallX = prevDur && a.meanDur ? (a.meanDur / prevDur).toFixed(2) + "x" : "-";
    console.log(
      "  " +
        pad(a.stage, 6) +
        pad(`${a.clears}/${nSeeds}`, 8) +
        pad(a.meanDur === null ? "-" : a.meanDur.toFixed(1), 9) +
        pad(wallX, 7) +
        pad(a.meanGpm === null ? "-" : Math.round(a.meanGpm), 9) +
        pad(a.totalAttempts, 10) +
        pad(a.totalWipes, 7) +
        pad(
          a.meanRec === null
            ? "-"
            : `${Math.round(a.meanRec)}:${Math.round(a.meanTeam ?? 0)}`,
          12,
        ),
    );
    if (a.meanDur !== null) prevDur = a.meanDur;
  }
}

// ---------------------------------------------------------------------------
// Pacing analysis / flags
// ---------------------------------------------------------------------------

function analyse(results: SeedResult[], agg: StageAgg[]): void {
  console.log(`\n=== PACING FLAGS ===`);
  const flags: string[] = [];

  // Early hook: first upgrade < ~20s, first boss kill in ~120-240s.
  const firstUps = results
    .map((r) => r.firstUpgradeTime)
    .filter((x): x is number => x !== null);
  const firstBoss = results
    .map((r) => r.firstBossKillTime)
    .filter((x): x is number => x !== null);
  if (firstUps.length) {
    const mu = mean(firstUps);
    flags.push(
      `first upgrade: mean ${mu.toFixed(1)}s ` +
        (mu <= 20 ? "OK (hooks fast)" : "SLOW (>20s target)"),
    );
  }
  if (firstBoss.length) {
    const mb = mean(firstBoss);
    flags.push(
      `first boss kill: mean ${mb.toFixed(1)}s ` +
        (mb >= 120 && mb <= 240
          ? "OK (~2-4 min target)"
          : mb < 120
            ? "FAST (<2 min, boss trivial?)"
            : "SLOW (>4 min)"),
    );
  }

  // Wall detection: first stage whose mean duration > 2.5x the previous.
  let prevDur: number | null = null;
  for (const a of agg) {
    if (a.meanDur !== null && prevDur !== null && a.meanDur > prevDur * 2.5) {
      flags.push(
        `WALL at stage ${a.stage}: ${a.meanDur.toFixed(1)}s vs ${prevDur.toFixed(
          1,
        )}s prev (${(a.meanDur / prevDur).toFixed(2)}x)`,
      );
    }
    if (a.meanDur !== null) prevDur = a.meanDur;
  }

  // Hint accuracy: recommended power (the suggested floor) vs the team power we
  // actually won with. team >> rec => boss trivialised (we're gated by the kill
  // goal, not power, so we overshoot). team < rec => the hint over-warned.
  for (const a of agg) {
    if (a.meanRec !== null && a.meanTeam !== null) {
      const ratio = a.meanTeam / a.meanRec;
      if (ratio > 1.6) {
        flags.push(
          `boss SOFT at stage ${a.stage}: won with team ${Math.round(
            a.meanTeam,
          )} vs recommended ${Math.round(a.meanRec)} (${ratio.toFixed(
            2,
          )}x) — kill-gated overshoot, boss trivial`,
        );
      } else if (ratio < 0.9) {
        flags.push(
          `hint HIGH at stage ${a.stage}: won with team ${Math.round(
            a.meanTeam,
          )} below recommended ${Math.round(a.meanRec)} (${ratio.toFixed(
            2,
          )}x) — hint over-warns`,
        );
      }
    }
  }

  // Dominant upgrade line: compare final level distribution.
  const totals = results.reduce(
    (acc, r) => {
      acc.atk += r.finalUpgrades.atk;
      acc.speed += r.finalUpgrades.speed;
      acc.hp += r.finalUpgrades.hp;
      return acc;
    },
    { atk: 0, speed: 0, hp: 0 },
  );
  flags.push(
    `final upgrade mix (sum over seeds) atk/spd/hp = ${totals.atk}/${totals.speed}/${totals.hp}`,
  );

  // Retreat loops (wipes) — a farm-wall symptom.
  const totalWipes = results.reduce((a, r) => a + r.totalWipes, 0);
  flags.push(`total boss wipes across seeds: ${totalWipes}`);

  for (const line of flags) console.log("  - " + line);
}

// ---------------------------------------------------------------------------
// Machine-parsable summary (single JSON line, prefix-tagged for grep)
// ---------------------------------------------------------------------------

function printMachineSummary(results: SeedResult[], agg: StageAgg[]): void {
  const summary = {
    simSeconds: SIM_SECONDS,
    seeds: SEEDS,
    finalStages: results.map((r) => r.finalStage),
    firstUpgradeMean: meanOrNull(results.map((r) => r.firstUpgradeTime)),
    firstBossKillMean: meanOrNull(results.map((r) => r.firstBossKillTime)),
    totalWipes: results.reduce((a, r) => a + r.totalWipes, 0),
    perStage: agg.map((a) => ({
      stage: a.stage,
      clears: a.clears,
      meanDur: a.meanDur === null ? null : round1(a.meanDur),
      meanGoldPerMin: a.meanGpm === null ? null : Math.round(a.meanGpm),
      attempts: a.totalAttempts,
      wipes: a.totalWipes,
      rec: a.meanRec === null ? null : Math.round(a.meanRec),
      team: a.meanTeam === null ? null : Math.round(a.meanTeam),
    })),
  };
  console.log("\nSIM_JSON " + JSON.stringify(summary));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
function meanOrNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? round1(mean(v)) : null;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main(): void {
  console.log(
    `[balance-sim] ${SIM_SECONDS}s (${STEPS} fixed steps) per seed, ` +
      `${SEEDS.length} seeds, auto-pilot on`,
  );
  const results = SEEDS.map(runSeed);
  for (const r of results) printSeed(r);
  const agg = aggregate(results);
  printAggregate(agg, results.length);
  analyse(results, agg);
  printMachineSummary(results, agg);
}

main();
