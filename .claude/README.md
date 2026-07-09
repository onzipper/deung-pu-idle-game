# .claude agents

Use these agents through the orchestrator. Do not make every agent read the full repo.
Routing is graded by **how much decision-making remains in the task** — see the routing
table in `CLAUDE.md` (the Agent tool's `model` param may override a persona's pin per-call;
`engine/` determinism, balance-sim adjudication, and `prisma/` schema never downgrade below Opus).

## Core workers

- `haiku-worker`: exact tiny edits, single-file, no judgement. The brief must contain everything.
- `fast-worker`: mechanical multi-file edits, scaffolding, formatting, simple tests.
- `deep-reasoner`: architecture/debugging/trade-offs. Returns concise decisions.

## Specialists

- `game-engine-specialist`: `src/engine/**` — simulation, determinism, fixed-timestep, save versioning.
- `game-economy-balance-designer`: balance, drops, gold sinks, refine, NPC shop economy, sim output.
- `sr-nextjs-developer`: `src/app/**`, `src/ui/**` — React/Next boundaries, GameClient loop, store wiring.
- `sr-uxui-game-designer`: UI/UX, game feel, visual hierarchy. Must read the `game-ux` skill.
- `pixi-render-performance-specialist`: `src/render/**` — PixiJS v8, pooling/filters, 60fps, coordinate seams.
- `sr-backend-developer`: API, persistence, auth/session, server-side invariants (`server/**`, `api/**`).
- `sr-dba`: Prisma schema, `prisma db push` safety, indexing (`prisma/**`).
- `qa-test-engineer`: tests, doc/path guards, regressions, deterministic coverage.
- `ai-docs-context-architect`: AI onboarding docs and token-efficient context routing (`AI.md`, `docs/context/**`).
- `liveops-release-manager`: patch notes, deploy checklists and ordering, release PR bodies.
- `i18n-th-en-copywriter`: `messages/th.json` / `messages/en.json`, UI labels, player-facing copy.

## Default reading rule

All agents start from `AI.md` + `docs/current-state.md`, then only their task-relevant
`docs/context/*.md` pack. `CLAUDE.md` is for Claude-specific orchestration rules only.
Anything touching code also reads `docs/known-traps.md`.

## Deferred

`asset-pipeline-art-director` was considered (issue #48) and deferred until real
sprite/icon/asset-pipeline work starts — do not re-propose; open a fresh issue when needed.
