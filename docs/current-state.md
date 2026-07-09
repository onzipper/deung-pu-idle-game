# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (post-R2.6, docs restructure #45)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → **R2.5 game screen ✅ → R2.6 quest tracker/skill dock ✅ (both on `develop`, unmerged)** → next R3 presence คนจริง → R4–R5 engine x,y → R6 shared elites.
- **Branches**: `develop` = R2 + R2.5 + R2.6 (ahead of `main`). `main` = M8.8 R1 (last merge PR #44).
- **Suite**: 2249+ tests green, tsc/eslint/next build clean. Patch notes current: 2026-07-09o.

## Latest work (on develop, awaiting owner)

- **R2.5 game screen** (M8.10): fullscreen canvas + all-overlay HUD both platforms; W0 input-drop root fix (rAF accumulator drained one-shot intents on 0-step frames — bot-off default + swallowed taps on 90Hz+); npcTrip replaces smithTrip; NPC walk-order buttons; minimap-lite.
- **R2.6**: quest tracker + skill dock per ref, both collapsible (`0466f81`).

## Blockers / owed

1. **Owner eye-test vs the ref** (fullscreen mobile portrait/landscape + desktop, bot-off on his 120Hz localhost, taps never vanish, NPC walk-order button feel, minimap, FTUE full run on fresh char, boss HP plate mid-screen position, quest tracker + skill dock).
2. On his confirm → **merge R2+R2.5+R2.6 to `main` as ONE block** (never merge without per-merge owner confirm).
3. **Deploy: relay FIRST** (presence counts endpoint) **then web. NO `prisma db push` pending.**

## Owner decisions affecting immediate work

- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- R3 presence คนจริง: action stream ~8Hz + snapshot-on-join + tap profile; relay opcode `pa` additive.
