# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ This project uses **Next.js 16** (App Router). It has breaking changes vs. older Next.js — see `AGENTS.md` and consult `node_modules/next/dist/docs/` before writing framework code.

## Project

**ดึ๋งปุ๊ Idle Game** — a single-character idle MMORPG-lite for the web (Ragnarok × IdleOn feel). Players create a character (up to 3 per account), pick a base class (sword/bow/magic), walk between zones where mobs spawn scattered and the hero **auto-hunts** them (passive mobs never strike first; aggressive ones near boss rooms do), allocate stat points, manage mana/skills with 3 unlockable auto-cast slots, class-change via a quest, buy potions from town NPCs, and (upcoming) collect weapon/armor drops (tradable item-instances), party up in real time (max 3, lockstep), and climb a multi-category Hall of Fame. Power = level + stats + class/skills + gear — no purchasable upgrade lines, no speed multiplier (both removed).

**Source of truth (in-repo, NOT ClickUp):** vision/direction = `docs/GDD.md` · roadmap + task checklists = `docs/ROADMAP.md`. Update checkboxes there as work lands; if anything conflicts, GDD.md wins. ClickUp is a legacy pointer only — do not fetch or update it in normal work.

Status (2026-07-06): **M1–M7 complete** (M5 = single-character pivot · M6 = zone/world + hunting fields + town + goal-ladder HUD · M7 = gear & drops end-to-end: 27-template catalog + deterministic drops [stateless splitmix32, never the wave RNG stream] at SAVE v10, server-authoritative ItemInstance/ItemEvent ledger with idempotent claims [`src/server/items.ts`, invariants in `docs/persistence-m7.md`], inventory/equip UI + claim pipeline, paper-doll gear on the original rigs with t6 epic weapon aura, codex gear collection). **M6.5 art exploration CLOSED** — owner keeps the original procedural style. Next: **M8 Party** (FIRST: VPS/websocket infra spike decision) → M9 Economy & Competition. PvP cut; prestige on hold. Balance baselines = `docs/balance-m6.md` (world) + `docs/balance-m7.md` (gear).

Git: `develop` = integration branch (work lands here per-task), `main` = stable (merged via PR at milestone boundaries).

## Commands

Package manager is **pnpm**.

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server → http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (includes the engine-purity boundary rule) |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | All Vitest suites (headless, Node env; 125+ tests, <1s) |
| `pnpm sim` | Balance harness — per-stage time-to-clear/gold/boss metrics; env knobs `SIM_SECONDS`, `SEEDS` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Prisma (needs `DATABASE_URL` in `.env`) |

Single test file: `pnpm test src/engine/__tests__/loop.test.ts` · by name: `pnpm vitest run -t "seeded rng"`

**Env quirk (subagent shells):** the pnpm `.cmd` shims sometimes can't resolve `node` (nested cmd.exe PATH issue). Workaround — invoke binaries directly: `node node_modules/eslint/bin/eslint.js .`, `node node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs run`, `node node_modules/tsx/dist/cli.mjs src/engine/__tests__/balance-sim.ts`. Not a project bug; don't spend time diagnosing it.

## Architecture — the load-bearing rule

Three layers, **strictly separate** (ESLint-enforced):

```
src/
  engine/   ← pure TS simulation. NO DOM/canvas/React/Pixi/Next/Zustand.
  render/   ← PixiJS: views (entities), fx (juice), environment (biomes), audio (WebAudio SFX). One-way reads.
  ui/       ← React HUD via throttled Zustand snapshot (~10Hz) + intent queue.
```

- **`engine/` is pure & deterministic**: `step(state, input)` advances exactly one `FIXED_DT` (1/60). Speed = more sub-steps, never bigger dt. Seeded RNG only (`core/rng.ts`) — **the RNG stream is reserved for wave composition; combat/skills must NEVER draw from it** (use fixed offset tables). All tunables in `engine/config` (the sim sweeps them). Save shape changes go through `SAVE_VERSION` + `migrate()` (`state/version.ts`).
- **`state.events`** (per-step, transient, deterministic, never persisted): 15+ event types (hit/kill/skillCast/boss lifecycle/…) consumed one-way by render/audio. Frame loops MUST collect events across ALL sub-steps before draw (they're cleared each step).
- **render/**: `GameRenderer.draw(state, frameEvents)`; pooled views keyed by entity id (build-once, transform-only per frame); `fx/` = pooled, capped, real-dt effect modules with knobs at top; `environment/` = stage-keyed biomes + parallax; `audio/` = synthesized SFX (no asset files), AudioContext after first gesture.
- **ui/**: components read narrow store selectors; player intents go into `pendingInput`, drained ONCE per real frame by `GameClient` (a click applies exactly once). `autoCast/autoAllocate/autoReturn/auto-potion thresholds/soundMuted` are plain UI-owned store fields (speed and autoUpgrade no longer exist).
- **`GameClient.tsx`** hosts the rAF loop (engine state in a closure, never React state) + `timeDirector.ts` (hit-stop/slow-mo: shapes ONLY the accumulator input; renderer/audio/UI keep real time — effects play through freezes by design).

Each layer has a `README.md` with its contract; `render/README.md` carries the **binding art direction** (desaturated scenery vs jewel-tone entities, flat-alpha layering).

## Persistence & economy

- MySQL (Hostinger) + **Prisma 6** (pinned; v7 needs driver adapters). Schema applied via **`prisma db push`** — shared host denies the shadow DB (P3014), so no migration history; baseline when the DB moves.
- Identity = anonymous httpOnly cookie (`src/server/identity.ts`, swappable for real auth). One save slot per user (`SaveState.userId @unique`).
- `POST /api/save` zod-validates strictly; **server stamps `lastSeen`** (client timestamps discarded). Offline idle capped `CONFIG.offlineCapHours`, replayed client-side through `step()` under a 250ms wall-clock budget.
- M5 target: re-derive max-plausible progress server-side; slot marked in `persistSave`.

## Hard-won footguns (each cost a real debugging round — don't re-learn them)

1. **Pixi transform double-subtraction**: Pixi applies `(local − pivot)` itself. Graphics paths inside pivoted containers must use absolute GROUND_Y-relative coords — never pre-subtract the pivot in path data, or rigs collapse toward y≈0. Guarded by `render/views/__tests__/rig.test.ts` (headless bounds).
2. **`Graphics.arc().fill()` without `moveTo`** collapses toward the stale pen position — use point-sampled `poly()` (see `arcFanPoints` in heroView).
3. **Every radius through `safeRadius()`**; no hand-built canvas gradients (layered flat alpha / Pixi filters only) — the original POC crash class.
4. **Windows 10 has no Unicode-13+ emoji glyphs** (🪙🪄…) — UI icons must be pre-2020 emoji or CSS-drawn.
5. **Absolute-position caps rot**: POC-era constants like `midCap` silently broke formation spacing when the anchor design deepened — prefer anchor/spawn-relative bounds with config knobs.
6. **New `ProjectileKind`/enum members need their render map entries in the same change** (`PROJECTILE_COLORS` etc.) or the client crashes at runtime ("Unable to convert color undefined") — grep for `Record<ProjectileKind` when extending engine unions.
7. **Balance changes must run the sim** vs the latest table in `docs/balance-m5.md` (per-class solo, 0 permanent walls; balance-m4 is the superseded team-comp baseline). Tune new knobs before touching tuned curves.
8. **Next 16: `cookies().set()` during a Server Component render throws** (`ReadonlyRequestCookiesError`) — cookie writes belong in Route Handlers / Server Actions only. Gate/redirect helpers in server components must be strictly read-only (see `src/app/characterGate.ts`).
9. **vitest does NOT typecheck and `next build` excludes test files** — type drift in test fixtures ships silently. After changes to shared engine types (Hero, saves), run a raw `node node_modules/typescript/bin/tsc --noEmit` sweep (ignore stale `.next/types` lines).
10. **Additive blend fx white-out on bright scenes** — flame/glow effects over daytime skies must use solid flame colors on normal blend + a darker outline, not `add` (learned in the /proto rounds; applies to the M7 weapon-aura work).

## Orchestration workflow

**You (Fable) are the orchestrator.** Plan, decompose, synthesize; execution goes to subagents. Keep your own context lean — agents return short conclusions.

Routing: reasoning-heavy → Opus domain agent or `deep-reasoner` · mechanical → Sonnet domain agent or `fast-worker` · trivial fully-specified single-file edits → `haiku-worker` · high-stakes → two independent perspectives in parallel, synthesize without cross-showing.

**Token discipline (learned from the M4 build-out):**
- One agent = one task; spawn fresh with a tight brief instead of chaining SendMessage (chained context re-reads cost 2-3x). Exception: urgent fixes on work the agent just wrote.
- Knob/feel tuning on known files → the orchestrator edits directly; no agent for a constant change.
- Batch same-area items into one medium task (~100-150k tokens); avoid 10+ item mega-passes and single-item micro-agents (fixed ~20-40k read-in each).
- Agent returns ≤20 lines; detail goes in commit messages / `docs/`.
- Cross-task context lives in repo files (render/README.md, docs/balance-m4.md), never chat history.
- Parallel agents must own disjoint file zones (engine vs render vs ui); the orchestrator commits per-zone by path.

## Project subagents

Personas in `.claude/agents/`, each pinned to a model:

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
