# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (post-R2.8 Wave B safe #58; history log v14–v15)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → **R2.5–R2.8 ✅ (game screen / tracker+dock / Wave A #55 / Wave B safe #58 — eye-tests passed) → R2.9 Codegen Asset Phase 1A ✅ (#60, awaiting owner eye-test)** → next R3 presence คนจริง → R4–R5 engine x,y → R6 shared elites.
- **Branches**: `develop` = R2 ถึง R2.8 (ahead of `main`). `main` = M8.8 R1 (last merge PR #44). R2.9 = PR from `ui/issue-60-codegen-icons-1a`.
- **Suite**: 2303 tests green, tsc/eslint/next build clean. Patch notes current: 2026-07-10d (icon slice).

## Latest work (on develop, awaiting owner)

- **R2.5 game screen** (M8.10): fullscreen canvas + all-overlay HUD both platforms; W0 input-drop root fix (rAF accumulator drained one-shot intents on 0-step frames — bot-off default + swallowed taps on 90Hz+); npcTrip replaces smithTrip; NPC walk-order buttons; minimap-lite.
- **R2.6**: quest tracker + skill dock per ref, both collapsible (`0466f81`).
- **#48 agent refresh** (PR #49, merged to `develop`): `.claude` agents re-pointed to `AI.md` + context packs, pre-pivot framing removed, `.claude/README.md` routing guide added, +4 agents (ai-docs-context-architect, pixi-render-performance-specialist, liveops-release-manager, i18n-th-en-copywriter); asset-pipeline-art-director deferred to a future issue. Docs-only.
- **#54 UI audit** (discussion, no code): 64-row scorecard vs the 2.5D ref posted to the issue — match 40 / partial 18 / missing 6 (missing = locked-defer/backlog only). Waves A–D proposed; owner questions pending: crit system (engine has none), menu-row 10-button scope, action rail, chat overlay.
- **R2.7 UI Wave A** (#55 / PR #56 merged): EXP % on ExpClockStrip · damage-number black stroke (first `TextStyle.stroke` in repo, construct-once) · top-edge z-5 scrim in GameHud · refine cost chips owned/required (42/30) + `danger` CurrencyChip variant when short · toast info = violet chrome · inventory "ทั้งหมด" tab (default). Web only.
- **R2.8 Wave B safe** (#58 / PR #59 merged, eye-test passed): BOT auto-skill picker → numbered icon-tile row mirroring SkillBar · mobile HUD tuning (menu-row 3→2 rows, FTUE anchors unchanged) · fixed ExpClockStrip box-height bug. B2 items (menu-row regroup / action rail / chat) still gated on owner answers in #54.
- **R2.9 Codegen Asset Phase 1A** (#60, branch `ui/issue-60-codegen-icons-1a`): new SVG icon language (silhouette+gradient+family glow per GAME ASSET OVERVIEW) — 9-id vertical slice (5 items incl. fort_weapon trap-coverage + 4 skills), NEW `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyphs = verbatim fallback for all other ids, NO image files (grep-asserted). Consumers: ItemTile (+`templateId` prop), SkillBar, SkillDetailModal, BOT picker. Phase 1B (remaining ids) after owner eye-test. Web only.

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
