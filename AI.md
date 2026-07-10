# AI.md — universal agent entry point

For **any** AI agent (Claude Code, Codex-style, others). Claude-specific orchestration
rules live in [CLAUDE.md](CLAUDE.md); everything here applies to everyone.

## Start here (in order)

1. [README.md](README.md) — what the game is, stack, commands.
2. [docs/current-state.md](docs/current-state.md) — what is current, blocked, owed, and off-limits *right now*.
3. [docs/decision-index.md](docs/decision-index.md) — locked decisions. Do not re-propose rejected ideas.
4. [docs/feature-map.md](docs/feature-map.md) — feature → docs/source/tests map (only for your task's feature).

Then read **only** the context pack matching your task type, then only the affected files.

## Context routing

| Task type | Read |
|---|---|
| UI / HUD / panels | [docs/context/ui.md](docs/context/ui.md) + [docs/ui-reference-map.md](docs/ui-reference-map.md) |
| Engine / simulation / determinism | [docs/context/engine.md](docs/context/engine.md) + [docs/context/testing.md](docs/context/testing.md) |
| Bot / automation | [docs/context/bot.md](docs/context/bot.md) + [docs/known-traps.md](docs/known-traps.md) |
| World / zones / party / presence | [docs/context/world.md](docs/context/world.md) + relevant [docs/GDD.md](docs/GDD.md) section |
| Economy / balance | [docs/context/economy.md](docs/context/economy.md) + [docs/context/testing.md](docs/context/testing.md) |
| Deployment / persistence / relay | [docs/context/deployment.md](docs/context/deployment.md) |
| Anything touching code at all | [docs/known-traps.md](docs/known-traps.md) — recurring bug classes, each cost a real debugging round |

File → responsibility lookup (instead of searching `src/`): [docs/CODEMAP.md](docs/CODEMAP.md).

## Token rules

- Do **not** read all of `src/` before making a plan — use CODEMAP + feature-map to find files.
- Do **not** read [docs/history/](docs/history/) unless current-state points you there.
- Small task: read **no more than 5 files** before proposing a plan (budget details: [docs/token-budget.md](docs/token-budget.md)).
- Long docs (GDD, ROADMAP, balance docs): read the relevant section, not the whole file.

## Required behavior

- **Plan before editing.** State which systems you will touch.
- State the test commands you will run (see [docs/context/testing.md](docs/context/testing.md)).
- Call out deploy impact explicitly: **web / relay / db push / none**. Relay changes deploy relay-FIRST.
- Every code change updates the affected docs in the same change — at minimum
  [docs/CODEMAP.md](docs/CODEMAP.md) on any file add/move/delete (test-enforced by
  `src/__tests__/codemap.test.ts`, which also stale-checks `src/` paths cited in
  feature-map and context packs).
- Match existing patterns; reuse existing utilities (check CODEMAP before writing new ones).

## Never change without explicit owner confirmation

- Merging `develop` → `main` (per-merge confirm, every time).
- `prisma/schema.prisma` or anything requiring `prisma db push`.
- Engine determinism surface: RNG stream usage, `step()` semantics, save shape (`SAVE_VERSION`).
- Relay protocol (`scripts/party-relay/`) — additive/versioned only, with deploy-order notes.
- Anything marked **Locked** in [docs/decision-index.md](docs/decision-index.md).
- Production deploys — always owner-triggered.

## What to avoid reading unless needed

- `docs/history/` — superseded status logs (archaeology only).
- `docs/balance-*.md` beyond the table relevant to your change.
- `src/lab/**` — owner's personal experiment zone; never modify it either.
