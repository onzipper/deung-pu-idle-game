# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (post-R2.8 Wave B safe #58; history log v14–v15)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → **R3 presence คนจริง ✅ MERGED (#50 / PR #62, owner eye-test passed + tune round; RELAY DEPLOYED by owner 2026-07-10 — web side goes live with the next develop→main deploy)** → R4–R5 engine x,y → R6 shared elites.
- **Branches**: `develop` = R2 ถึง R3 (ahead of `main`). `main` = M8.8 R1 (last merge PR #44).
- **Suite**: 2375 tests green, tsc/eslint/next build clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R3 presence คนจริง** (#50, **Draft PR #62**, staged 5 commits by wave — full detail history v17): relay additive `pa` action stream (not cached, never liveness) · 8Hz publisher + fps valve shared with ghost cap (single source 33/22ms) · ghostStore action fields + render-only GhostPose (no GameEvents, p-only ghosts pixel-identical) · tap-ghost view-only GhostProfileCard (zero pendingInput writes, test-pinned) · ghostGuard determinism expansion · patch notes 2026-07-10e. Deploy: **relay FIRST** then web.
- **R2.9 Codegen Asset Phase 1A** (#60 / PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Phase 1B (remaining ids) after owner eye-test.
- **#54 UI audit**: scorecard posted; owner questions still open — crit system / menu-row scope / action rail / chat overlay (gates Wave B ชุดที่เหลือ). R2.5–R2.8 detail → history v13–v15.

## Blockers / owed

1. **Relay deployed ✅ (owner, 2026-07-10) — web deploy pending**: R3 web side goes live with the develop→`main` block. **NO `prisma db push` pending.**
2. **Owner eye-test ค้าง**: R2.9 icon slice (#60 ยังเปิดรอ eye-test) + ก้อน R2.5–R2.6 เดิม (fullscreen/FTUE/minimap ฯลฯ).
3. On owner confirm → **merge develop→`main` as ONE block** (never without per-merge confirm) → **web deploy** (relay ทำไปแล้ว).

## Owner decisions affecting immediate work

- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- R3 presence คนจริง: action stream ~8Hz + snapshot-on-join + tap profile; relay opcode `pa` additive.
