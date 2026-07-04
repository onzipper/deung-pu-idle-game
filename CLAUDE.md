# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ This project uses **Next.js 16** (App Router). It has breaking changes vs. older Next.js — see `AGENTS.md` and consult `node_modules/next/dist/docs/` before writing framework code.

## Project

**ดึ๋งปุ๊ Idle Game** — a 2D idle / auto-battler for the web. A team of up to 3 hero classes auto-advances through enemy waves, banks kills, challenges a boss, clears the stage, unlocks the next hero/upgrade, and loops. Systems: skills (cooldown + auto-cast), three separate upgrade lines (+ auto), and a 1×/2×/3× speed multiplier.

Status: past POC (a single playable HTML+Canvas file proved the core loop). This repo is the **production rebuild on Next.js**. Tracked in ClickUp task [86d3jv7m3](https://app.clickup.com/t/86d3jv7m3).

## Commands

Package manager is **pnpm**.

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server → http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (includes the engine-purity boundary rule) |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | Run all Vitest suites (headless, Node env) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm sim` | Run the headless balance-simulation harness |
| `pnpm db:generate` | Regenerate Prisma client (also runs on `postinstall`) |
| `pnpm db:migrate` | `prisma migrate dev` (needs a live `DATABASE_URL`) |
| `pnpm db:studio` | Prisma Studio |

Run a single test file: `pnpm test src/engine/__tests__/loop.test.ts`
Run tests by name: `pnpm vitest run -t "seeded rng"`

## Architecture — the load-bearing rule

Three layers are kept **strictly separate**. This is the single most important design constraint; do not blur it.

```
src/
  engine/   ← pure TypeScript game simulation. NO DOM, canvas, React, Pixi, Next.
  render/   ← PixiJS. Reads engine state, draws it. One-way.
  ui/       ← React HUD/menus. Reads a throttled engine snapshot via Zustand.
```

- **`engine/` is pure.** It is a state transformer (`step(state, dt, input) → state`) with no I/O, no wall-clock reads, and a seeded RNG (`engine/core/rng.ts`) — never `Math.random()`. Purity is enforced by ESLint: importing `react`, `pixi.js`, `zustand`, `next`, or any of `@/render`, `@/ui`, `@/server`, `@/lib` from `engine/**` is a lint error. The payoff is that combat and balance run **headless under Vitest**, which is how the nasty POC bugs get caught without opening a browser.
- **`render/` and `ui/` import the engine only through `@/engine` (its `index.ts`)** — never reach into engine internals.
- **`ui/` must never hold per-frame game state.** React re-renders on every store write; syncing at 60 Hz kills performance. The engine pushes a **throttled** snapshot (~10 Hz, `CONFIG.uiSyncHz`) of only the HUD-visible fields into the Zustand store (`src/ui/store/gameStore.ts`).

Each layer has its own `README.md` describing responsibilities and the import boundary.

### Game loop

Fixed-timestep + accumulator (`src/engine/core/loop.ts`, `FIXED_DT = 1/60`). Deterministic. A speed multiplier runs **more fixed sub-steps**, never a larger `dt` (that is what prevents tunnelling at 2×/3×). Offline idle catch-up feeds the (capped) elapsed time through the same accumulator.

### Path aliases

`@/*` → `src/*` (so `@/engine/...`, `@/render/...`, etc. all resolve). Configured in `tsconfig.json` and mirrored for Vitest in `vitest.config.ts`.

## Persistence & economy

- **DB: MySQL + Prisma 6** (`prisma/schema.prisma`). Pinned to v6 deliberately — Prisma 7 removed `url` from the datasource and requires driver adapters + `prisma.config.ts`, which is unneeded connection surface at this stage. Upgrading to 7 is a known future option.
- **Save model:** `SaveState` stores the versioned `SaveData` JSON blob (`src/engine/state`), a `version`, and `lastSeen`. `User` owns saves.
- **Save versioning from day one:** `src/engine/state/version.ts` holds `SAVE_VERSION` + `migrate()`. Bump the version and add a migration branch whenever `SaveData` changes shape — never mutate an old save without going through `migrate()`.
- **Offline idle** (`src/server/offline.ts`): earnings computed from server wall-clock vs `lastSeen`, **capped** (`CONFIG.offlineCapHours`) as anti-cheat. Runs server-side only.
- **Server-authoritative economy:** the target is that gold/upgrades can be re-validated server-side so a tampered client can't grant currency. MVP may compute client-side, but keep the shape server-authoritative for monetization/anti-cheat. Save/load lives in `src/app/api/save/route.ts` + `src/server/`.

Set `DATABASE_URL` in `.env` (see `.env.example`) before any `db:migrate`/runtime DB use.

## Known POC bugs to avoid (rendering only — never in `engine/`)

1. **Negative-radius `IndexSizeError`** — the POC `shockwave()` pushed rings with `life > dur`, making `r = maxR*(1 - life/dur)` go negative and throwing in `ctx.arc()`. In the Pixi rebuild, clamp any radius `Math.max(0, r)`; Pixi avoids raw `arc` so this largely disappears.
2. **`createRadialGradient` + `addColorStop` crash** when a CSS var resolved empty in a sandbox. Use Pixi filters instead of hand-built gradients.

These are **rendering** concerns and belong in `render/`. The pure engine has no visual code.

## Milestones

- **M1** — Engine port: extract core loop + entities + combat as pure TS + unit tests. *(scaffold done; engine port next)*
- **M2** — Render (Pixi) + UI (React/Zustand): draw the game + HUD/upgrade/skill panels.
- **M3** — Persistence: MySQL + Prisma, save/load, offline idle.
- **M4** — Balance & juice: balance simulation, effects/particles/sound. (Framer Motion + GSAP get installed here, not before.)
- **M5** — Prestige/reset loop + server-authoritative economy & anti-cheat.

Current state: **M1 scaffold complete** — Next.js + TS + tooling + the empty 3-layer skeleton. No game logic yet.

## Orchestration workflow

**You (Fable) are the orchestrator.** Plan, decompose, and synthesize — but do the heavy *execution* through subagents so Fable tokens are spent only on genuine orchestration and hard reasoning. **Keep your own context lean:** hand subagents a tight spec, and have them return a short, actionable conclusion rather than pulling large outputs back into your context.

Routing:
- **Reasoning-heavy** (architecture, tricky debugging, algorithm/economy design) → the relevant **Opus** domain agent, or the generic `deep-reasoner` (Opus) when it's not domain-specific.
- **Mechanical** (boilerplate, tests, formatting, simple/repetitive edits) → the relevant **Sonnet** domain agent, or the generic `fast-worker` (Sonnet).
- **High-stakes decisions** — task two independent perspectives on the same problem in parallel (e.g. two Opus agents from different angles), then synthesize the best of both **without showing either the other's answer**. (A slot for an external peer like OpenAI Codex can be added here later; not wired up yet.)

Each subagent is pinned to a model in its frontmatter, so delegation is automatically cost-aware — Fable orchestrates, Opus/Sonnet do the work.

## Project subagents

Personas live in `.claude/agents/`, each pinned to a model. Delegate to them:

**Generic (model-tier roles)**
| Agent | Model | Use for |
|---|---|---|
| `deep-reasoner` | Opus | reasoning-heavy, non-domain-specific problems |
| `fast-worker` | Sonnet | mechanical, well-specified execution |
| `haiku-worker` | Haiku | trivial fully-specified single-file edits (label/knob/doc changes) |

**Token discipline (learned from the M4 build-out):**
- One agent = one task; spawn fresh with a tight brief instead of chaining SendMessage (chained context re-reads cost 2-3x).
- Feel/knob tuning on files the orchestrator knows → orchestrator edits directly; don't spawn an agent for a constant change.
- Batch same-area items into one medium task (~100-150k tokens); avoid 10+ item mega-passes and avoid single-item micro-agents (fixed ~20-40k context-read cost each).
- Agent returns: ≤20 lines, conclusions only; put detail in the commit message or docs/ — the orchestrator's context is the scarcest resource.
- Shared context across tasks goes in repo files (render/README.md art direction, docs/balance-m4.md), never in chat history.

**Domain experts**
| Agent | Model | Scope |
|---|---|---|
| `game-engine-specialist` | Opus | pure-TS simulation core, fixed-timestep, determinism (`engine/**`) |
| `game-economy-balance-designer` | Opus | cost curves, pacing, prestige, balance-sim tuning |
| `sr-dba` | Opus | MySQL/Prisma schema, migrations, indexing (`prisma/**`) |
| `sr-backend-developer` | Opus | save/load, offline idle, server economy/anti-cheat (`server/**`, `api/**`) |
| `sr-nextjs-developer` | Sonnet | App Router, React/Zustand, Pixi mounting (`app/**`, `ui/**`) |
| `sr-uxui-game-designer` | Sonnet | game feel, juice, animation, HUD/effects (M4) |
| `qa-test-engineer` | Sonnet | headless Vitest strategy, determinism/regression tests |
