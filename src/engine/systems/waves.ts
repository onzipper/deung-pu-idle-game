/**
 * Wave scheduling + composition (POC `rollWave` / `startWave` + the gap timer in
 * the update loop).
 *
 * RNG ordering (must stay stable for determinism): a wave first draws ONE value
 * per enemy to pick its kind (`rollWave`), then `makeEnemy` draws two more per
 * enemy (initial cd, engage jitter). This mirrors the POC, where `rollWave()`
 * is fully evaluated before the `makeEnemy` loop runs.
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import type { Rng } from "@/engine/core/rng";
import { makeEnemy } from "@/engine/entities";
import type { EnemyKind } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** Roll the kinds for one wave, stage-gated exactly like the POC. */
export function rollWave(state: GameState, rng: Rng): EnemyKind[] {
  const n =
    CONFIG.waveCountBase +
    Math.floor(state.wave * CONFIG.waveCountPerWave) +
    Math.floor(state.stage * CONFIG.waveCountPerStage);
  const wc = CONFIG.waveComp;
  const list: EnemyKind[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    let kind: EnemyKind = "normal";
    if (state.stage >= 1 && r < wc.fastChance) kind = "fast";
    else if (state.stage >= 2 && r < wc.rangedChanceS2) kind = "ranged";
    else if (state.stage >= 2 && r < wc.tankChanceS2) kind = "tank";
    else if (state.stage >= 3 && r < wc.rangedChanceS3) kind = "ranged";
    list.push(kind);
  }
  return list;
}

/** Advance the wave counter and spawn the next wave of enemies. */
export function startWave(state: GameState, rng: Rng): void {
  state.wave++;
  const kinds = rollWave(state, rng);
  kinds.forEach((kind, i) => {
    const e = makeEnemy(state.nextId++, kind, state.stage, state.wave, rng);
    e.x = CONFIG.spawnX + i * CONFIG.spawnGap;
    state.enemies.push(e);
  });
  state.waveGap = CONFIG.waveGap;
  state.events.push({ type: "waveSpawn", wave: state.wave });
}

/** Count down the inter-wave gap and spawn when the arena is clear. */
export function updateWaveSpawns(state: GameState, rng: Rng): void {
  if (state.phase === "battle" && state.enemies.length === 0) {
    state.waveGap -= FIXED_DT;
    if (state.waveGap <= 0) startWave(state, rng);
  }
}
