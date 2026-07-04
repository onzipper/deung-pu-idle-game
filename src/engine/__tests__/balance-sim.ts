/**
 * Balance-simulation harness (headless).
 *
 * Runs the engine with no renderer to measure pacing across a fixed sim window
 * and several seeds. To exercise the FULL loop (not just wave grinding) it plays
 * a simple auto-pilot: auto-upgrade on, auto-cast on, challenge the boss as soon
 * as it's ready, and advance to the next stage on victory. Because the engine is
 * pure, this is just a loop over `step()` — no browser, no canvas.
 *
 * Run with: `pnpm sim`
 */

import { initGameState, step, bossHint, FIXED_DT, type FrameInput } from "@/engine";

const SIM_SECONDS = 300;
const STEPS = Math.round(SIM_SECONDS / FIXED_DT);
const SEEDS = [1, 2, 3, 42, 1337];

function main(): void {
  console.log(
    `[balance-sim] ${SIM_SECONDS}s (${STEPS} fixed steps) per seed, auto-pilot on\n`,
  );
  console.log("seed     stage  wave  kills   gold   bossFights");
  for (const seed of SEEDS) {
    const s = initGameState(seed);
    s.autoUpgrade = true;
    s.autoCast = true;
    let bossFights = 0;

    for (let i = 0; i < STEPS; i++) {
      const input: FrameInput = {};
      // Farm + auto-upgrade until the team looks strong enough, THEN challenge.
      if (s.phase === "battle" && s.bossReady && bossHint(s).ready) {
        input.challengeBoss = true;
        bossFights++;
      } else if (s.phase === "victory") {
        input.advanceStage = true;
      }
      step(s, input);
    }

    console.log(
      [
        seed.toString().padEnd(8),
        s.stage.toString().padEnd(6),
        s.wave.toString().padEnd(5),
        s.kills.toString().padEnd(6),
        Math.floor(s.gold).toString().padEnd(6),
        bossFights.toString(),
      ].join(" "),
    );
  }
}

main();
