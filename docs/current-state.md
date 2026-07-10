# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (R4.5 Wave 1 merged — capped depth scale + contact shadows, #69)._

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → R4 engine x,y CODE-COMPLETE (#51 awaiting owner eye-test) → **R4.5 map direction IN PROGRESS (#69 — Phase 0 approved, Wave 1 merged; Wave 2 Forest Road slice next)** → R5 2D combat (#52, gated on #54 crit answer + R4.5 direction pass) → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4.5 Wave 1.
- **Suite**: 2424 tests green, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **R4.5 Wave 1 — capped depth scale + contact shadows** (#69, Phase 0 owner-approved: projection C "MMO field board with subtle depth" · scale 0.95–1.06 · Forest Road = Wave 2 · props visual-only): `DEPTH_SCALE_FAR/NEAR` **0.8/1.12 → 0.95/1.06** (offsets −24/+40 untouched; strictly-monotonic invariant + tests intact) · NEW `src/render/views/entityShadow.ts` — build-once flat-alpha two-ellipse contact shadow (α≈0.30 composited, no gradient/filter/additive) as BACKMOST child of each foot-pivoted actor root: hero/enemy(elite-aware via `effectiveSize`)/stage+world boss/town NPCs/ghosts; pooled, transform-only steady state, no orphans · NEW `docs/map-direction.md` = R4.5 direction spec (cue priority, Wave plan 0–4, Forest Road slice list) · decision-index +2 Locked rows · **zero engine diffs** (sim untouched by construction); tap ping still lands on tapped row (offsets unchanged, tests green).
- **R4 Wave C2 manual x/y + dash y + tap plumbing** (#51, last R4 code step): `FrameInput.moveTo` gains optional `y` (additive; x-only byte-identical) — clamped to `[bandFar, bandNear]` at EVERY input path (intake, town walk, dash landing; non-finite y = absent) · hunt-phase + town MOVE command steers `planeY` to command.y via `stepPlaneY`, clears only when BOTH axes arrive · `dashHeroTo` lands on a farm mob's row via `enemyDashPlaneY` (boss/worldBoss → undefined → row unchanged, C1 rule); 3 ninja call sites plumbed · tap→planeY: `hitTestMath.tapToPlaneY` inverts `depthOffsetY`, one arena handler desktop+mobile, engine re-clamps · `moveOrdered` event gains optional `y` (move ping at tapped depth); `heroDashed` unchanged (streak at fixed HERO_MID_Y, hero view follows live planeY) · **relay OPAQUE, no protocol change — proven**: JSON round-trip + wired-vs-direct LockstepClient hash equality + mixed x-only/x-y 2-client 800-turn run · SAVE_VERSION stays 20 · sim gates unmoved.
- **R4 Waves A–C1** (#51 / PRs #64–#67): engine-owned deterministic `planeY` (spawn-stamped, stateHash, SAVE v20 test-proven) → render cutover bit-exact → scaffold retired (single depth path; boss/NPC + enemies static all R4, owner-confirmed) → hero y steering with attack-timing byte-identical proof. Detail → PR bodies / history log.
- **R3 presence คนจริง** (#50 / PR #62 merged, release PR #63): relay additive `pa` action stream · 8Hz publisher + fps valve · render-only GhostPose · tap-ghost GhostProfileCard · ghostGuard expansion. Relay deployed ✅; web goes live next main deploy. Full detail history v17.
- **R2.9 Codegen Asset Phase 1A** (#60 / PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Phase 1B (remaining ids) after owner eye-test.
- **#54 UI audit**: scorecard posted; owner questions still open — crit system / menu-row scope / action rail / chat overlay (gates Wave B ชุดที่เหลือ). R2.5–R2.8 detail → history v13–v15.

## Blockers / owed

1. **R4 owner eye-test** (#51, checklist on the Wave C2 PR): tap x/y far/near/clamp-edges · idle return-to-row · ninja dash lands on mob's lane but NOT boss's · NPC/gate taps no depth drift · mobile portrait/landscape + desktop identical. Pass → close #51 → merge R4 block to `main` on per-merge confirm.
2. **Web deploy from `main`** — R3 block merged (PR #63); relay deployed ✅; **NO `prisma db push`**. Post-deploy spot check: bot-off default บน prod · 2 identities เห็นกัน ~8Hz · tap profile · relay-down degrade เงียบ.
3. Issue เปิดค้างรอ owner: **#60** (icon slice eye-test → เคาะ Phase 1B) · **#55** (ปิดได้ งานจบแล้ว) · **#54** (4 คำถาม: crit / menu-row / action rail / chat — crit answer gates R5 #52).

## Owner decisions affecting immediate work

- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- **Owner eye-test สองรายการรวมรอบเดียวได้**: R4 checklist (PR #68) + R4.5 Wave 1 checklist (PR #69 Wave 1) — both on localhost dev.
- R4.5 Wave 2 (#69): Forest Road code-drawn biome slice per `docs/map-direction.md` — after the Wave 1 scale verdict passes.
- R5 (#52) first PR = targeting metric flip — needs #54 crit answer + R4.5 direction pass. R6 (#53) Wave 1 (inert schema+server+API) can start any time on owner approval.
