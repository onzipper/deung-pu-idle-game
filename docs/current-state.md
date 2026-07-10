# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (R4 Wave A engine y-plane merged, #51 Wave A)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → **R4 engine x,y IN PROGRESS — Wave A merged, Wave B next** → R5 2D combat → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4 Wave A engine y-plane (PR #64).
- **Suite**: 2388 tests green, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R4 Wave A engine y-plane** (#51 / PR #64, plan approved in issue comments): NEW `src/engine/systems/plane.ts` — pure deterministic plane/y helpers, math ported verbatim from `render/worldDepth/{depthBand,depthAssign}` (engine imports nothing from render) · additive `planeY` field on Hero/Enemy/Boss stamped at every spawn site via stateless entity-id hashing (seeded wave RNG untouched) · `CONFIG.plane` namespace (bandFar/bandNear/formation/ySpeed) pinned to render constants by test · `planeY` included in lockstep stateHash · **SAVE_VERSION stays 20 — proven by tests** (planeY lives only on never-persisted live entity arrays, recomputed at spawn on load). Render byte-neutral: existing `Entity.y` (torso anchor used by hit/heroDown/fastTravel fx) deliberately NOT repurposed. Combat stays x-based; sim gates byte-identical. Wave B (render cutover behind flag) + Wave C (y movement) = separate PRs.
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

- R4 Wave B (#51): render cutover to `entity.planeY` behind `worldDepthFromEngineY` flag + pixel-identity test. Prep notes on PR #64: party builder must set `heroPlaneY(cls, slot, size)` before cutover (solo row default otherwise) · town-NPC/ghost placement via `scatterPlaneY` needs identity/pixel test · keep `CONFIG.plane` ↔ render constants test-pinned until the render depth source is removed.
