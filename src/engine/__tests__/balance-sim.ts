/**
 * Balance-simulation harness (headless).
 *
 * Runs the engine with no renderer to measure pacing: gold/kills/waves over a
 * fixed sim window across a few seeds. Because the engine is pure, this is just
 * a loop over `step()` — no browser, no canvas.
 *
 * Run with: `pnpm sim`
 */

import { initGameState, step, FIXED_DT } from "@/engine";

const SIM_SECONDS = 120;
const STEPS = Math.round(SIM_SECONDS / FIXED_DT);
const SEEDS = [1, 2, 3, 42, 1337];

function main(): void {
  console.log(`[balance-sim] ${SIM_SECONDS}s (${STEPS} fixed steps) per seed\n`);
  console.log("seed     stage  wave  kills   gold  bossReady");
  for (const seed of SEEDS) {
    const s = initGameState(seed);
    for (let i = 0; i < STEPS; i++) step(s, {});
    console.log(
      [
        seed.toString().padEnd(8),
        s.stage.toString().padEnd(6),
        s.wave.toString().padEnd(5),
        s.kills.toString().padEnd(6),
        Math.floor(s.gold).toString().padEnd(6),
        s.bossReady ? "yes" : "no",
      ].join(" "),
    );
  }
}

main();
