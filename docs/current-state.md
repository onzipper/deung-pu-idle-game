# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (R4 Wave C0 scaffold retirement merged, #51)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → **R4 engine x,y IN PROGRESS — Waves A+B+C0 merged; C1 (y steering) + C2 (moveTo/dash x,y) next** → R5 2D combat → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4 Wave C0.
- **Suite**: 2387 tests green, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R4 Wave C0 scaffold retirement** (#51, owner-approved plan): `worldDepthFromEngineY` flag DELETED — engine `planeY` → `planeToDepth` is now the ONLY depth path at `worldFxContext.depthOf` · `depthAssign.ts` trimmed to `hashUnit` only (`heroDepth`/`enemyDepth`/`ghostDepth` + row constants removed; `hashUnit` kept — terrain/weather consume it) · no-`planeY` fallback at seam = `hashUnit(id)` (bit-exact to retired hash path — FxController kill-time event fx pass null planeY at 10 sites; DEPTH_NEUTRAL would have shifted them) · identity test retired (reconfirmed green immediately before deletion) · `plane.test.ts` render-constant pin retired (lock-step job done); `depthBand` parity + determinism + SAVE proofs stay · **Static-path decision recorded (owner-confirmed): stage/world boss + town NPCs stay static all of R4; enemies keep static scatter (no y-chase) — revisit both at R5**. Zero behavior change; suite −9 net (retired tests).
- **R4 Wave B render cutover** (#51 / PR #65): render reads `entity.planeY` at the `worldFxContext.depthOf` seam (hero/enemy/bossAdd draw, ghost via `scatterPlaneY(cid)`, hit-tests) · `planeToDepth` inverse proven bit-exact (200k hash values + all fan/solo rows) · party fan stamped in `buildCohortState` via `heroPlaneY(cls, slot, size)`. No SAVE_VERSION change; sim gates unmoved.
- **R4 Wave A engine y-plane** (#51 / PR #64): `src/engine/systems/plane.ts` pure deterministic y helpers · additive `planeY` on Hero/Enemy/Boss at spawn via stateless entity-id hashing · `planeY` in lockstep stateHash · **SAVE_VERSION stays 20, test-proven** (planeY transient, recomputed at spawn) · `Entity.y` torso anchor NOT repurposed. Combat stays x-based.
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

- R4 Wave C1 (#51): engine y steering — `planeY` becomes mutable per-step: hero steers to target's lane at `CONFIG.plane.ySpeed` when engaging, returns to per-hero home row (`heroPlaneY(cls, slot, size)`, the "anchor-y equivalent" — no `state.anchorY` scalar) when idle. **Iron invariant: y never gates an attack** — range stays `|Δx|`, attack timing byte-identical (test-pinned). Enemies keep static scatter (owner-confirmed). Watch item from C0: kill-time event fx resolve the spawn-hash row via null-planeY fallback — if C1 wants death/drop beats to track the moved row, those events must start carrying planeY.
- R4 Wave C2 (#51): manual moveTo gains optional y (clamp to `[bandFar, bandNear]`) + `tickTownManualWalk` y + dash lands on target's planeY + UI tap sends y via existing hitTestMath unproject + additive y on `moveOrdered`/`heroDashed` events with render fx map updated in same change. Verify FrameInput y rides relay opaquely (no relay change; buildId gates mixed-version parties).
