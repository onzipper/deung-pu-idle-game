# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (R4 Wave C1 hero y steering merged, #51)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → **R4 engine x,y IN PROGRESS — Waves A+B+C0+C1 merged; C2 (moveTo/dash x,y + tap plumbing) = last R4 step** → R5 2D combat → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4 Wave C1.
- **Suite**: 2400 tests green, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R4 Wave C1 hero y steering** (#51): hero `planeY` mutable per-step — pure `stepPlaneY(current, target, dt)` in `plane.ts` (ease at `CONFIG.plane.ySpeed`, snap-and-hold within new `yArriveEps: 0.5`; +/−/clamp only), wired as an unconditional cosmetic step at the END of the per-hero loop in `combat.ts` (reads `aimTarget`+`planeY`, writes `planeY` only — adds/reorders NO x-move/attack) · engaged farm mob → steer to its lane; idle/move/no-target → RECOMPUTED home row `heroPlaneY(cls, idx, heroes.length)` · **boss phase + world boss steer HOME, never to `boss.planeY`** (bosses render static `DEPTH_NEUTRAL`; adopting their stamped +40 row would desync from what's drawn) · enemies/boss/NPCs stay static (owner-confirmed) · **kill-time fx audit: NO event changes needed** — hero fx read live `planeY` (heroes never leave state), enemy fx spawn-hash fallback is exact for static enemies (documented in engine.md + render README, revisit if C2/R5 moves enemies) · **attack-timing byte-identical + x-only-range test-pinned**; balance sim diffed before/after = IDENTICAL · SAVE_VERSION stays 20.
- **R4 Wave C0 scaffold retirement** (#51 / PR #66): `worldDepthFromEngineY` flag + OFF branch + render depth-assignment retired — engine `planeY` single path at `worldFxContext.depthOf`; seam no-`planeY` fallback = engine `hashUnit(id)` (bit-exact; covers FxController kill-time fx). Static-path decision recorded (boss/NPC static + enemy static scatter all R4). Zero behavior change.
- **R4 Waves A+B** (#51 / PRs #64 #65): engine-owned deterministic `planeY` (pure `plane.ts` helpers, spawn-stamped via entity-id hashing, in lockstep stateHash, SAVE_VERSION stays 20 test-proven) + render cutover at `worldFxContext.depthOf` (bit-exact `planeToDepth` inverse; party fan via `buildCohortState`). Detail → PR bodies / history log.
- **R3 presence คนจริง** (#50 / PR #62 merged, release PR #63): relay additive `pa` action stream · 8Hz publisher + fps valve · render-only GhostPose · tap-ghost GhostProfileCard · ghostGuard expansion. Relay deployed ✅; web goes live next main deploy. Full detail history v17.
- **R2.9 Codegen Asset Phase 1A** (#60 / PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Phase 1B (remaining ids) after owner eye-test.
- **#54 UI audit**: scorecard posted; owner questions still open — crit system / menu-row scope / action rail / chat overlay (gates Wave B ชุดที่เหลือ). R2.5–R2.8 detail → history v13–v15.

## Blockers / owed

1. **Web deploy from `main`** — R3 block merged (PR #63); relay deployed ✅; **NO `prisma db push`**. Post-deploy spot check: bot-off default บน prod · 2 identities เห็นกัน ~8Hz · tap profile · relay-down degrade เงียบ.
2. Issue เปิดค้างรอ owner: **#60** (icon slice eye-test → เคาะ Phase 1B) · **#55** (ปิดได้ งานจบแล้ว) · **#54** (4 คำถาม: crit / menu-row / action rail / chat).

## Owner decisions affecting immediate work

- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- R4 Wave C2 (#51, LAST R4 step): manual moveTo gains optional y (clamp to `[bandFar, bandNear]`) + `tickTownManualWalk` y + dash lands on target's planeY + UI tap sends y via existing hitTestMath unproject + additive y on `moveOrdered`/`heroDashed` events with render fx map updated in same change. Verify FrameInput y rides relay opaquely (no relay change; buildId gates mixed-version parties). Then R4 owner eye-test → #51 closes → R5 (#52) unblocks pending the #54 crit answer.
