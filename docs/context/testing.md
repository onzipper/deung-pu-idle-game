# Context Pack — Test Strategy

## Suites

Headless Vitest, Node environment, 2249+ tests across `src/**/__tests__/`, runs in well under a second for the full suite.

```
pnpm test                                            # everything
pnpm test src/engine/__tests__/loop.test.ts          # single file
pnpm vitest run -t "seeded rng"                      # by test name
pnpm test src/ui                                     # scope to a directory
```

## The balance sim harness

```
pnpm sim
SIM_SECONDS=5400 SEEDS=<n> pnpm sim   # canonical config — see docs/context/economy.md
```
Not a pass/fail test — a per-stage time-to-clear/gold/boss-outcome report, adjudicated by eye against `docs/balance-*.md`.

## CODEMAP sync test

`src/__tests__/codemap.test.ts` mechanically enforces `docs/CODEMAP.md`:
1. Every backtick-wrapped `src/...` path referenced in CODEMAP must exist on disk (no stale paths after a move/delete).
2. Every non-test source file under `src/` (excluding `src/lab/**`) must have its own CODEMAP line.

Any file add/move/delete/repurpose must update `docs/CODEMAP.md` in the **same change**, or `pnpm test` fails.

## Determinism / hash-equality suites

These pin byte-identical simulation output across seeds/clients — a failure here means a real desync bug, not flakiness:
- `src/engine/__tests__/determinism.test.ts`, `src/engine/__tests__/float-determinism-guard.test.ts`
- `src/engine/lockstep/__tests__/lockstep.test.ts` (multi-client hash-equal over thousands of turns)
- `src/app/(game)/presence/__tests__/ghostGuard.test.ts` (proves presence/chat never touch engine state)

## Identity / "all-OFF" tests

Render feature toggles (world depth/camera/atmosphere, ghosts) must be pixel-identical to the pre-feature baseline when OFF — pinned in `src/render/worldDepth/__tests__/` and `src/render/__tests__/`.

## Read first

1. `src/__tests__/codemap.test.ts` if you're about to add/move/delete a source file.
2. The `__tests__/` directory adjacent to the file you're changing — match its existing patterns before adding new test styles.

## Important quirks

- **`vitest` does NOT typecheck**, and `next build` **excludes test files** — type drift in test fixtures ships silently. After changing a shared engine type (`Hero`, `SaveData`, etc.), run a raw typecheck sweep:
  ```
  node node_modules/typescript/bin/tsc --noEmit
  ```
  (ignore stale `.next/types` lines).
- **Subagent shell quirk**: pnpm's `.cmd` shims sometimes can't resolve `node` (nested cmd.exe PATH issue on Windows). Workaround — invoke binaries directly:
  ```
  node node_modules/eslint/bin/eslint.js .
  node node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs run
  node node_modules/tsx/dist/cli.mjs src/engine/__tests__/balance-sim.ts
  ```
  This is an environment quirk, not a project bug — don't spend time diagnosing it further.

## Known risks

- A green `pnpm test` does not guarantee typecheck cleanliness — always pair a shared-type change with the raw `tsc --noEmit` sweep above.
- Sim "gates" (per-class solo clear, boss-win rates) are a soft pass/fail judged against `docs/balance-*.md`, not an automated assertion — don't skip reading the doc.

## Do not touch

- Never weaken a hash-equality/determinism test to make it pass — trace the actual desync source (see [engine.md](./engine.md) risks).
- Never delete a `docs/CODEMAP.md` line without also deleting/moving the file it maps — the sync test will catch a stale line, but an agent silently deleting the doc line without the code fix defeats the whole point.
