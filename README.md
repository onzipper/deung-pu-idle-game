# ดึ๋งปุ๊ Idle Game

A web-based **2.5D open-world idle MMO RPG** — Ragnarok-like feel with idle automation.
Single character auto-hunts across zones; the player steers stats, skills, gear/refine
(ตีบวก), class changes, and can party up in real time (lockstep, max 6). Fixed camera
today; true x/y movement is on the roadmap. Power = level + stats + class/skills + gear —
no purchasable upgrade lines, no speed multiplier.

## Tech stack

Next.js 16 (App Router) · React 19 · PixiJS 8 · Zustand · Prisma 6 (MySQL) · Zod ·
Vitest · next-intl (th/en). Package manager is **pnpm**.

## Quick start

```bash
pnpm install
pnpm dev      # → http://localhost:3000
pnpm test     # headless Vitest suites
pnpm sim      # balance harness (SIM_SECONDS / SEEDS env knobs)
pnpm build    # production build
```

## Source of truth

| What | Where |
|---|---|
| Vision / design (wins conflicts) | [docs/GDD.md](docs/GDD.md) |
| Roadmap + task checklists | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Current project state (updated every round) | [docs/current-state.md](docs/current-state.md) |
| UI reference + owner-approved decisions | [docs/ui-reference-map.md](docs/ui-reference-map.md) |
| Docs table of contents | [docs/README.md](docs/README.md) |
| **AI agent guide (start here if you are an AI)** | [AI.md](AI.md) |
| Claude Code–specific guidance | [CLAUDE.md](CLAUDE.md) |

## AI onboarding (short version)

Read, in order: this file → [AI.md](AI.md) → [docs/current-state.md](docs/current-state.md)
→ the task-matching pack in [docs/context/](docs/context/) → only the affected files.
Do **not** crawl `src/` or the full docs history first — [docs/CODEMAP.md](docs/CODEMAP.md)
and [docs/feature-map.md](docs/feature-map.md) already map files to responsibilities.
Locked decisions live in [docs/decision-index.md](docs/decision-index.md); recurring bug
classes in [docs/known-traps.md](docs/known-traps.md).

Git flow: `develop` = integration (work lands per task) · `main` = stable, merged via PR
only with explicit owner confirmation.
