# Context Pack — Balance / Economy

## Purpose

Every gold/xp/drop/refine/consumable curve in the game, tuned to keep progression meaningful across ~30-40 zones without hard walls (a small number of intentional soft bands aside) and without gold hyperinflation outrunning sinks.

## Current shape

- Gold sinks: NPC potions/scrolls (`src/engine/systems/consumables.ts`, **flat pricing** — an accepted owner-approved late-game gold-accumulation debt, revisit before central marketplace), refine ตีบวก (`src/engine/config/refine.ts`, ~8%/level, ceiling +10), legendary craft + awakening (`src/server/asura.ts`, `src/engine/systems/asura.ts`).
- Enhancement stones + asura essence/sigils: endgame material sinks for ดินแดนอสูร (map 7) and legendary crafting.
- Level cap currently 90 (+10 headroom bands documented per map in `docs/balance-*.md`).
- World boss + Hall of Fame seasonal rewards: gold/stones/fortifier per character per window (`src/server/worldBoss.ts`, `src/server/hofSeason.ts`) — deliberately not power-inflationary (see `docs/balance-worldboss.md`'s reward-% verdict).

## The one rule that matters

**Every balance-relevant change must run `pnpm sim` against the latest table in the matching `docs/balance-*.md` before being called done.** The canonical adjudication config is **5400s, GEAR+REFINE enabled** — the default 1800s run WITHOUT gear cannot even beat the tier-3 quest boss (this has caused real false alarms; always specify the canonical config explicitly).

```
pnpm sim                              # default env
SIM_SECONDS=5400 SEEDS=<n> pnpm sim   # canonical adjudication run (add GEAR/REFINE knobs per docs/balance-*.md)
```

## Read first

1. The most recent `docs/balance-*.md` file for the system you're touching (`balance-m5.md` world, `balance-m7.md` gear/vendor, `balance-m79.md` grand expansion, `balance-ninja.md`, `balance-worldboss.md`, `balance-asura.md`) — each documents the CURRENT tuned numbers and gate verdicts.
2. `src/engine/config/index.ts` (`CONFIG`) — the one home for tunables.
3. `src/engine/__tests__/balance-sim.ts` — the sim harness itself (per-stage time-to-clear/gold/boss metrics).

## Tests to run

```
pnpm sim
pnpm test src/engine/__tests__/economy.test.ts
```
Any config change should also pass the full engine determinism suite (`pnpm test src/engine`) since sim adjudication assumes byte-identical hashing across seeds.

## Known risks

- Tuning one class/system in isolation can silently regress another — the sim harness reports per-class solo baselines; check ALL classes, not just the one you touched.
- A curve that "feels right" without a sim run is not adjudicated — docs/known-traps.md #12 exists because of a real regression class here.
- Flat shop pricing (owner call) trades correctness for simplicity — do not "fix" the resulting late-game gold surplus without an explicit owner ask; a future event/sink system is the planned answer.

## Do not touch

- Never tune a shipped/tuned curve without running the sim first and comparing against the relevant `docs/balance-*.md` table — new knobs should be tuned in isolation before touching already-tuned ones.
- Never let combat/skills/drop-roll code draw from the seeded RNG stream (`core/rng.ts`) — see [engine.md](./engine.md); this would make sim runs non-reproducible across seeds in the wrong way.
- Never change reward payouts (world boss, HOF) without checking the inflation verdict in the matching balance doc — these are deliberately capped as non-inflationary per-era.
