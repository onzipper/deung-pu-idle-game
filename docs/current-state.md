# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (owner eye-test: R4.5 Wave 1 passed; mobile + map design follow-ups opened)._ 

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → R4 engine x,y CODE-COMPLETE (#51; desktop path can continue, mobile design split to #78) → **R4.5 map direction IN PROGRESS (#69 — Phase 0 approved, Waves 1+1.1+1.2 merged; owner passed Wave 1 depth/scale/contact shadow; Wave 2 map design NOT accepted yet, see #79)** → R5 2D combat (#52, gated on #54 crit answer + R4.5 direction pass) → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4.5 Wave 1.2 + AI role memory.
- **Suite**: 2461 tests green at Wave 1.2 close-out, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **Owner eye-test verdicts (2026-07-10)**: R4.5 Wave 1 depth/scale/contact-shadow direction **passed**. R4 x/y mobile experience is **not accepted** yet because there is no approved mobile gameplay/HUD design; moved to #78 and should not block desktop/R4.5 Wave 1 acceptance. R4.5 Wave 2 `map2` farm-zone map design is **not accepted**; current stack remains Draft/prototype until map reference/design is approved in #79.
- **AI collaboration memory**: `AI.md` now records stable roles — Owner decides direction/approval, ChatGPT is owner-side advisor/reviewer/asset partner/visual QA, Claude Code/Fable orchestrates implementation and PRs.
- **R4.5 Wave 1.2 — ghost/actor depth interleave** (#69 follow-up): GhostLayer roots now live INSIDE the shared `entities` sortable container (siblings of hero/enemy roots) — one `depthZIndex(d)` domain, so ghosts/heroes/enemies interleave by row · sort key branches on new `worldFx.depthEnabled()` seam accessor: depth ON → band zIndex; depth OFF → `GHOST_FLAT_ZINDEX −11000` (pre-#69 "ghosts under party" order preserved byte-for-byte) · combat hit-test inherently ghost-free (`hitTestPointer` scans engine `state.enemies`/worldBoss, never container children); `hitTestGhost` intact · hero-vs-enemy sorting verified already-correct (test-pinned now) · Wave-1.1 behaviors all preserved (live planeY/fallback/shadow/fade/pose pulses) · NEW `ghostInterleave.test.ts` (7 tests) · note: ghosts now take the actor night-tint instead of scenery ambientTint (peer-actor treatment — owner passed Wave 1 overall; keep future tint changes explicit).
- **R4.5 Wave 1.1 — ghost live planeY + manual y hold** (#69 follow-up from owner eye-test): (1) presence `p` payload gains additive `py` (`Math.round(hero.planeY)`, only-when-finite; `v:1` unchanged, no new opcode) → `ghostStore` parses to `planeY: number|null` (missing/malformed → null never 0; band-clamped) with its OWN ease anchor clock (`planeYAt` — separate from `lerpAt` which `pa` re-stamps at 8Hz and would freeze the row) → `ghostLayer` uses `item.planeY ?? scatterPlaneY(cid)` (absent-y peers byte-identical; contact shadow rides the live row) · **relay audit: `handlePresence` forwards payload verbatim (v-check + 256B cap only) → NO relay deploy** · ghostGuard extended with py-garbage variants, still green. (2) engine: transient `Hero.planeYHold` — set when a move-with-y arrives (both axes), cleared by x-only move completion + zone arrival; steering priority = engaged-mob lane > active command.y > `hold ?? home`; boss/worldBoss → `hold ?? home` never boss row · in stateHash present-only · **SAVE_VERSION stays 20** (`toSaveData` asserted clean) · combat first-hit/kill ticks byte-identical with hold active · sim unmoved.
- **R4 Wave C2 manual x/y + dash y + tap plumbing** (#51, last R4 code step): `FrameInput.moveTo` gains optional `y` (additive; x-only byte-identical) — clamped to `[bandFar, bandNear]` at EVERY input path (intake, town walk, dash landing; non-finite y = absent) · hunt-phase + town MOVE command steers `planeY` to command.y via `stepPlaneY`, clears only when BOTH axes arrive · `dashHeroTo` lands on a farm mob's row via `enemyDashPlaneY` (boss/worldBoss → undefined → row unchanged, C1 rule); 3 ninja call sites plumbed · tap→planeY: `hitTestMath.tapToPlaneY` inverts `depthOffsetY`, one arena handler desktop+mobile, engine re-clamps · `moveOrdered` event gains optional `y` (move ping at tapped depth); `heroDashed` unchanged (streak at fixed HERO_MID_Y, hero view follows live planeY) · **relay OPAQUE, no protocol change — proven**: JSON round-trip + wired-vs-direct LockstepClient hash equality + mixed x-only/x-y 2-client 800-turn run · SAVE_VERSION stays 20 · sim gates unmoved.
- **R3 presence คนจริง** (#50 / PR #62 merged, release PR #63): relay additive `pa` action stream · 8Hz publisher + fps valve · render-only GhostPose · tap-ghost GhostProfileCard · ghostGuard expansion. Relay deployed ✅; web goes live next main deploy. Full detail history v17.
- **R2.9 Codegen Asset Phase 1A** (#60 / PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Phase 1B (remaining ids) after owner eye-test.
- **#54 UI audit**: scorecard posted; owner questions still open — crit system / menu-row scope / action rail / chat overlay (gates Wave B ชุดที่เหลือ). R2.5–R2.8 detail → history v13–v15.

## Blockers / owed

1. **Mobile gameplay/HUD direction** (#78) — R4 x/y mobile is not accepted yet; define portrait/landscape gameplay field, HUD collapse, touch targets, and tap affordance before calling mobile final.
2. **R4.5 Wave 2 map design** (#79) — `map2` farm-zone map design is not accepted; do not merge Wave 2 stack as final visual direction until a map reference/design is approved.
3. **Web deploy from `main`** — R3 block merged (PR #63); relay deployed ✅; **NO `prisma db push`**. Post-deploy spot check: bot-off default บน prod · 2 identities เห็นกัน ~8Hz · tap profile · relay-down degrade เงียบ.
4. Issue เปิดค้างรอ owner: **#60** (icon slice eye-test → เคาะ Phase 1B) · **#55** (ปิดได้ งานจบแล้ว) · **#54** (4 คำถาม: crit / menu-row / action rail / chat — crit answer gates R5 #52).

## Owner decisions affecting immediate work

- R4.5 Wave 1 depth/scale/contact-shadow direction passed owner eye-test on 2026-07-10.
- R4 x/y mobile acceptance split to #78; do not block desktop/R4.5 Wave 1 on lack of mobile design.
- R4.5 Wave 2 map2 farm-zone design rejected for now; use #79 to lock map reference before accepting/merging Wave 2 visuals.
- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- Attach owner visual references as binary files in `docs/references/` and link them from `docs/ui-reference-map.md` (design reference only, not runtime assets).
- Create/choose a map reference for `map2` farm zones (#79), then ask Fable to revise the Wave 2 stack against that design.
- Keep R4.5 Wave 2 PRs Draft until map design passes; do not merge #73→#76 as final visuals yet.
- R5 (#52) first PR = targeting metric flip — needs #54 crit answer + R4.5 direction pass. R6 (#53) Wave 1 (inert schema+server+API) can start any time on owner approval.
