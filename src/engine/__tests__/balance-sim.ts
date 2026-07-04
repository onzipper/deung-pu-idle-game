/**
 * Balance-simulation harness (headless).
 *
 * Runs the engine with no renderer to measure balance: e.g. "how many fixed
 * steps to clear stage N with build X", win-rate vs a boss, gold-per-minute
 * curves. Because the engine is pure, this is just a loop over `step()` — no
 * browser, no canvas.
 *
 * Run with: `pnpm sim`
 *
 * Skeleton: wired to the real `step()` during the engine port (M1).
 */

function main(): void {
  // Example shape (pseudo, pending engine port):
  //   const rng = createRng(seed);
  //   let state = initState(build);
  //   const acc = createAccumulator();
  //   while (!cleared(state) && state.time < maxTime) {
  //     const steps = drainAccumulator(acc, FIXED_DT, speed);
  //     for (let i = 0; i < steps; i++) state = step(state, FIXED_DT, input);
  //   }
  //   report({ stage, steps, gold: state.gold });

  console.log("[balance-sim] harness stub — implement with engine port (M1)");
}

main();
