# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (R4 Wave B render cutover merged, #51 Wave B)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → **R4 engine x,y IN PROGRESS — Waves A+B merged, Wave C next** → R5 2D combat → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4 Wave B render cutover.
- **Suite**: 2396 tests green, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R4 Wave B render cutover** (#51): render reads engine-owned `entity.planeY` behind render-side flag `worldDepthFromEngineY` (default ON, OFF path intact) at the `worldFxContext.depthOf` seam — hero/enemy/bossAdd draw, ghost draw via `scatterPlaneY(cid)` (exact `ghostDepth` inverse), enemy+ghost hit-tests · `planeToDepth` inverse proven **bit-exact** over 200k hash values + all fan/solo rows (band width 64 = 2ⁿ) · party fan stamped in `buildCohortState` via `heroPlaneY(cls, slot, size)` (solo rebuild byte-identical to `makeHero`) · temporary identity test `worldDepthEngineYIdentity.test.ts` pins ON===OFF exact (d/footY/scale/zIndex) per entity class — **retires at Wave C** · deliberate: stage/world boss + town NPCs stay on `placeStaticActor`/`DEPTH_NEUTRAL` static path (consuming `bossPlaneY` would shift ~40px + break frontmost zIndex; documented in render README). No SAVE_VERSION change; sim gates unmoved.
- **R4 Wave A engine y-plane** (#51 / PR #64): NEW `src/engine/systems/plane.ts` — pure deterministic plane/y helpers ported verbatim from `render/worldDepth/{depthBand,depthAssign}` · additive `planeY` on Hero/Enemy/Boss at every spawn site via stateless entity-id hashing (seeded wave RNG untouched) · `CONFIG.plane` pinned to render constants by test · `planeY` in lockstep stateHash · **SAVE_VERSION stays 20 — proven by tests** (planeY never persisted, recomputed at spawn). `Entity.y` (torso anchor for hit/heroDown/fastTravel fx) NOT repurposed. Combat stays x-based.
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

- R4 Wave C (#51): y movement/steering — anchors gain `(anchorX, anchorY)`, manual moveTo + dash handle 2D, formation y per class knob-only; combat range checks STAY x-based (metric flip = R5). At Wave C: delete `worldDepthFromEngineY` flag + hash fallback in `depthAssign` + retire the identity test; decide the static-path cutover for stage/world boss + town NPCs if they move in y (watch item from Wave B).
