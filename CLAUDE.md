# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ This project uses **Next.js 16** (App Router). It has breaking changes vs. older Next.js — see `AGENTS.md` and consult `node_modules/next/dist/docs/` before writing framework code.

## Project

**ดึ๋งปุ๊ Idle Game** — a single-character open-world idle MMO RPG 2.5D for the web (Ragnarok × IdleOn feel): auto-hunting hero, 3→4 classes with tier chains, gear + refine (ตีบวก), real-time party (lockstep, max 6), ghost presence + world chat, world boss, Hall of Fame. Power = level + stats + class/skills + gear — no purchasable upgrade lines, no speed multiplier.

**Source of truth (in-repo, NOT ClickUp):** vision = `docs/GDD.md` (wins conflicts) · roadmap/checklists = `docs/ROADMAP.md` · UI decisions = `docs/ui-reference-map.md`. ClickUp is a legacy pointer — don't fetch it in normal work.

**Current status** (live file, updated every round):

@docs/current-state.md

**Entry docs**: universal agent guide = `AI.md` · docs ToC = `docs/README.md` · file→responsibility index = `docs/CODEMAP.md` · task-type context packs = `docs/context/` · locked decisions = `docs/decision-index.md` · full status history = `docs/history/claude-status-log.md`.

Git: `develop` = integration branch (work lands here per-task), `main` = stable (merged via PR at milestone boundaries). **Never merge develop→main without explicit per-merge owner confirm.**

## Commands

Package manager is **pnpm**.

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server → http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (includes the engine-purity boundary rule) |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | All Vitest suites (headless, Node env) |
| `pnpm sim` | Balance harness; env knobs `SIM_SECONDS`, `SEEDS` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Prisma (needs `DATABASE_URL` in `.env`) |

Single test file: `pnpm test src/engine/__tests__/loop.test.ts` · by name: `pnpm vitest run -t "seeded rng"`

**Env quirk (subagent shells):** the pnpm `.cmd` shims sometimes can't resolve `node` (nested cmd.exe PATH issue). Workaround — invoke binaries directly: `node node_modules/eslint/bin/eslint.js .`, `node node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs run`, `node node_modules/tsx/dist/cli.mjs src/engine/__tests__/balance-sim.ts`. Not a project bug; don't spend time diagnosing it.

## Architecture — the load-bearing rule

Three layers, **strictly separate** (ESLint-enforced): `src/engine/` = pure deterministic TS simulation (`step(state, input)` at fixed 1/60 dt, seeded RNG reserved for wave composition ONLY, tunables in `engine/config`, save changes via `SAVE_VERSION` + `migrate()`) → `src/render/` = PixiJS one-way reads (pooled views, fx, biomes, synthesized audio) → `src/ui/` = React HUD via throttled Zustand snapshot (~10Hz) + intent queue drained ONCE per real frame by `GameClient.tsx` (rAF loop + timeDirector). `state.events` = per-step transient events consumed one-way by render/audio; collect across ALL sub-steps before draw. Full contracts: each layer's `README.md` + `docs/context/engine.md` / `ui.md`; `render/README.md` carries the binding art direction. Persistence/economy contract: `docs/context/deployment.md` (MySQL + Prisma 6 via `prisma db push`, anonymous-cookie→account identity, server stamps `lastSeen`).

**Before touching engine/render/ui code, read `docs/known-traps.md`** — recurring bug classes (rAF intent drain, Pixi pivot double-subtraction, template-lookup superset, ModalPortal, determinism rules). Each one cost a real debugging round.

Balance changes must run the sim vs the latest `docs/balance-*.md` table and hold every gate.

## Orchestration workflow

**You (Fable) are the orchestrator.** Plan, decompose, synthesize; execution goes to subagents. Keep your own context lean — agents return short conclusions (≤20 lines; detail goes in commits/docs).

**Routing = grade by how much DECISION-MAKING remains in the task, not by domain (owner-approved 2026-07-09):**

| Task shape | Tier |
|---|---|
| Design work, debugging with unknown cause, trade-offs to weigh | Opus |
| Brief names the files + a reference pattern; only execution remains | Sonnet |
| Single file, change specified down to the exact text | Haiku |

- **Model override beats new personas:** the Agent tool's `model` param overrides a persona's pinned model — e.g. routine backend work = `sr-backend-developer` + `model: sonnet`. Don't add duplicate `.claude/agents/` files for tiers.
- **Never-downgrade guardrail:** `engine/` determinism work, balance-sim adjudication, and `prisma/` schema stay Opus always.
- **CODEMAP-first briefs:** paste the relevant `docs/CODEMAP.md` section (or `docs/context/` pack) into the brief instead of letting the agent explore. Only use read-only `Explore` for questions the map can't answer.
- **Haiku by default** for patch-notes copy, i18n strings, single CONFIG value changes, doc appends, label swaps.
- One agent = one task; spawn fresh with a tight brief instead of chaining SendMessage. Batch same-area items into one medium task; parallel agents own disjoint file zones. Knob/feel tuning on known files → orchestrator edits directly.
- High-stakes → two independent perspectives in parallel, synthesize without cross-showing.
- Cross-task context lives in repo files, never chat history.

## Docs discipline (owner directive 2026-07-09, extended 2026-07-10 #45)

**Every code change must update the affected docs in the same change** — include this in every agent brief:

- `docs/CODEMAP.md` — add/move/delete/repurpose a source file ⇒ update its line. Enforced by `src/__tests__/codemap.test.ts` (also stale-checks `src/` paths cited in `docs/feature-map.md` + `docs/context/*.md`).
- `docs/current-state.md` — **update every round**; superseded status blocks append to `docs/history/claude-status-log.md` (never grow an inline blob here).
- Layer `README.md` (engine/render/ui/server) — when a layer *contract* changes.
- `docs/ROADMAP.md` checkboxes as work lands; `docs/GDD.md` wins conflicts.
- The relevant `docs/*.md` design/balance/context doc — when behavior it documents changes.

Keep CODEMAP lines *structural* (path + one-line responsibility), never content-level detail.

## Project subagents

Personas in `.claude/agents/`, each pinned to a model (the pin is the DEFAULT — the routing table above may override per-call via the Agent tool's `model` param):

| Agent | Model | Scope |
|---|---|---|
| `deep-reasoner` / `fast-worker` / `haiku-worker` | Opus / Sonnet / Haiku | generic tiers (see routing) |
| `game-engine-specialist` | Opus | pure-TS sim core, determinism (`engine/**`) |
| `game-economy-balance-designer` | Opus | curves, pacing, prestige, sim analysis |
| `sr-dba` | Opus | MySQL/Prisma schema, indexing (`prisma/**`) |
| `sr-backend-developer` | Opus | save/load, offline idle, anti-cheat (`server/**`, `api/**`) |
| `sr-nextjs-developer` | Sonnet | App Router, GameClient loop, store wiring (`app/**`, `ui/**`) |
| `sr-uxui-game-designer` | Sonnet | game feel, fx/animation/biomes, HUD design (`render/**`, `ui/**`) |
| `qa-test-engineer` | Sonnet | headless Vitest strategy, regression suites |
