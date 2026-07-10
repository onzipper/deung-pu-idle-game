# Context Pack — Project Overview

## What this is

ดึ๋งปุ๊ Idle Game — a single-character **open-world MMO RPG 2.5D with bots** (Ragnarok × IdleOn feel; vision v3, 2026-07-09). A player creates a character (up to 3/account, base class sword/bow/magic, +ninja as a 4th unlockable), walks between zones where mobs spawn scattered, and the hero **auto-hunts** them. Power = level + base stats + class/skills + gear — no purchasable power lines. Players allocate stat points, manage mana/skills (3 unlockable auto-cast slots), class-change via quest, buy potions from town NPCs, collect tradable weapon/armor drops (server-authoritative item-instances), refine gear (ตีบวก), party up in real time (max 6, lockstep), see ghost presence of other real players, fight a shared-HP world boss, and climb a multi-category Hall of Fame.

Camera is fixed 2.5D, never rotates. Full 1D→2D (x,y) movement is a future engine milestone (R4-R5); today's world is effectively 1D per zone.

## Source of truth

- **Vision/direction**: `docs/GDD.md` — wins any conflict.
- **Roadmap + task checklists**: `docs/ROADMAP.md` — update checkboxes as work lands.
- **UI chrome mapping**: `docs/ui-reference-map.md` — owner-approved reference decisions, do not re-litigate items marked "เคาะแล้ว".
- ClickUp is a legacy pointer only — do not fetch/update it for this project.

## Three-layer architecture (hard-enforced boundary)

```
src/
  engine/   ← pure TS simulation. NO DOM/canvas/React/Pixi/Next/Zustand (ESLint-enforced).
  render/   ← PixiJS: views (entities), fx (juice), environment (biomes), audio (WebAudio SFX). One-way reads of GameState.
  ui/       ← React HUD via throttled Zustand snapshot (~10Hz) + intent queue (pendingInput).
```

- `engine/step(state, input)` advances exactly one `FIXED_DT` (1/60s), deterministically. Speed = more sub-steps, never a bigger dt.
- `render/GameRenderer.draw(state, frameEvents)` reads `GameState` one-way; never mutates it.
- `ui/` components read narrow Zustand store selectors; intents (allocate stat, cast skill, move, etc.) go into `pendingInput`, drained exactly once per real frame by `src/app/(game)/GameClient.tsx` — the seam that hosts the rAF loop and owns engine state in a closure (never React state).
- Each layer has its own `README.md` with the full contract: `src/engine/README.md`, `src/render/README.md`, `src/ui/README.md`, `src/server/README.md`.

See the per-layer context packs for detail: [engine.md](./engine.md) · [render is covered inside ui.md/world.md per feature] · [ui.md](./ui.md) · [bot.md](./bot.md) · [world.md](./world.md) · [economy.md](./economy.md) · [testing.md](./testing.md) · [deployment.md](./deployment.md). Feature→file routing: [../feature-map.md](../feature-map.md).

## Git flow

- `develop` = integration branch — day-to-day work lands here.
- `main` = stable — merged via PR **only with explicit owner confirmation per merge** (never merge develop→main autonomously).
- Deploys are owner-triggered, never automatic (see [deployment.md](./deployment.md) for order rules).

## Read first

1. This file, then the layer README relevant to your task.
2. `docs/CODEMAP.md` — file→responsibility index; paste the relevant section into agent briefs instead of exploring.
3. `docs/ui-reference-map.md` before any UI/visual work — owner decisions are binding.
4. `docs/GDD.md` "ทิศทางใหญ่ v3" section for the current arc (open-world MMO, R1-R6).

## Tests to run

`pnpm test` (full headless Vitest suite) before considering any change done; see [testing.md](./testing.md) for scoping to a single area.

## Known risks

- Engine determinism breaks desync party lockstep — any `engine/` change needs the hash-equality suites green.
- UI/render boundary violations (importing pixi/react/zustand into `engine/**`) fail ESLint — this is enforced, not a style preference.
- Docs rot fast here — this context pack is deliberately structural; content-level status lives in docs/current-state.md + ROADMAP.md.

## Do not touch

- Never merge `develop` → `main` without an explicit owner confirmation for that specific merge.
- Never resurrect the deleted gold-upgrade power lines (`UpgradePanel`, speed multiplier) — GDD v2/v3 removed them by design.
- Never add a display string to `engine/config` — content strings live in `messages/*.json`, resolved via the engine's own stable ids.
