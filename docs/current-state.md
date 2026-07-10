# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-10 (owner DIRECTION RESET: World Arc v1 + free-field 2.5D replaces the x-axis-first Map2 path)._ 

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → R4 engine x,y CODE-COMPLETE (#51; substrate KEPT, mobile design split to #78) → R4.5 Wave 1 depth language ✅ (owner-passed, KEPT) → **DIRECTION RESET (owner 2026-07-10): World Arc v1 + Free-field 2.5D — spec `docs/world-arc-freefield-v1.md` on branch `r45/world-arc-freefield-v1`; old Map2/Greenmill x-axis-first stack (PRs #73–#76) SUPERSEDED/historical** → R5 2D combat (#52, gated on #54 crit answer) → R6 shared elites.
- **Branches**: `main` = R3 block (PR #63). `develop` = R4.5 Wave 1.2 + AI role memory. `r45/world-arc-freefield-v1` = new-direction spec (this round).
- **Suite**: 2461 tests green at Wave 1.2 close-out, tsc/eslint clean. Patch notes current: 2026-07-10e (R3 presence).

## Latest work

- **DIRECTION RESET — World Arc v1 + Free-field 2.5D** (owner 2026-07-10): the x-axis-first field model and the Map2 "Greenmill Hamlet" Wave 2 design are **no longer active** — hard reset, not a patch. New spec: `docs/world-arc-freefield-v1.md` — world = 10 areas (Capital Outskirts → Farm Border Road → Old Forest Path → Moonshade Grove → Forgotten Shrine → Hollow Ravine → Crystal Fault → Ashen Gate → Otherworld Verge → Rift Sanctum); field = free-field 2.5D (click/tap any reachable point, real x/y positioning, road = visual guide, depth from foot position, walkable data phased in later). KEPT: projection C + Wave 1 depth language (owner-passed) + Wave 1.2 shared sort domain + all R4 x/y plumbing (the substrate). SUPERSEDED: PRs #73/#74/#75/#76 (nothing from them reached develop; Wave 2B WIP preserved in a labeled stash on `r45/issue-69-wave2b-ground`). Decision index, map-direction, ROADMAP (new M8.15) synced.
- **Owner eye-test verdicts (2026-07-10)**: R4.5 Wave 1 depth/scale/contact-shadow direction **passed**. R4 x/y mobile experience is **not accepted** yet because there is no approved mobile gameplay/HUD design; moved to #78 and should not block desktop/R4.5 Wave 1 acceptance.
- **AI collaboration memory**: `AI.md` now records stable roles — Owner decides direction/approval, ChatGPT is owner-side advisor/reviewer/asset partner/visual QA, Claude Code/Fable orchestrates implementation and PRs.
- **R4.5 Wave 1.2 — ghost/actor depth interleave** (#69 follow-up): GhostLayer roots now live INSIDE the shared `entities` sortable container (siblings of hero/enemy roots) — one `depthZIndex(d)` domain, so ghosts/heroes/enemies interleave by row · sort key branches on new `worldFx.depthEnabled()` seam accessor: depth ON → band zIndex; depth OFF → `GHOST_FLAT_ZINDEX −11000` (pre-#69 "ghosts under party" order preserved byte-for-byte) · combat hit-test inherently ghost-free (`hitTestPointer` scans engine `state.enemies`/worldBoss, never container children); `hitTestGhost` intact · hero-vs-enemy sorting verified already-correct (test-pinned now) · Wave-1.1 behaviors all preserved (live planeY/fallback/shadow/fade/pose pulses) · NEW `ghostInterleave.test.ts` (7 tests) · note: ghosts now take the actor night-tint instead of scenery ambientTint (peer-actor treatment — owner passed Wave 1 overall; keep future tint changes explicit).
- **R4.5 Wave 1.1 — ghost live planeY + manual y hold** (#69 follow-up from owner eye-test): (1) presence `p` payload gains additive `py` (`Math.round(hero.planeY)`, only-when-finite; `v:1` unchanged, no new opcode) → `ghostStore` parses to `planeY: number|null` (missing/malformed → null never 0; band-clamped) with its OWN ease anchor clock (`planeYAt` — separate from `lerpAt` which `pa` re-stamps at 8Hz and would freeze the row) → `ghostLayer` uses `item.planeY ?? scatterPlaneY(cid)` (absent-y peers byte-identical; contact shadow rides the live row) · **relay audit: `handlePresence` forwards payload verbatim (v-check + 256B cap only) → NO relay deploy** · ghostGuard extended with py-garbage variants, still green. (2) engine: transient `Hero.planeYHold` — set when a move-with-y arrives (both axes), cleared by x-only move completion + zone arrival; steering priority = engaged-mob lane > active command.y > `hold ?? home`; boss/worldBoss → `hold ?? home` never boss row · in stateHash present-only · **SAVE_VERSION stays 20** (`toSaveData` asserted clean) · combat first-hit/kill ticks byte-identical with hold active · sim unmoved.
- **R4 Wave C2 manual x/y + dash y + tap plumbing** (#51, last R4 code step): `FrameInput.moveTo` gains optional `y` (additive; x-only byte-identical) — clamped to `[bandFar, bandNear]` at EVERY input path (intake, town walk, dash landing; non-finite y = absent) · hunt-phase + town MOVE command steers `planeY` to command.y via `stepPlaneY`, clears only when BOTH axes arrive · `dashHeroTo` lands on a farm mob's row via `enemyDashPlaneY` (boss/worldBoss → undefined → row unchanged, C1 rule); 3 ninja call sites plumbed · tap→planeY: `hitTestMath.tapToPlaneY` inverts `depthOffsetY`, one arena handler desktop+mobile, engine re-clamps · `moveOrdered` event gains optional `y` (move ping at tapped depth); `heroDashed` unchanged (streak at fixed HERO_MID_Y, hero view follows live planeY) · **relay OPAQUE, no protocol change — proven**: JSON round-trip + wired-vs-direct LockstepClient hash equality + mixed x-only/x-y 2-client 800-turn run · SAVE_VERSION stays 20 · sim gates unmoved.
- **R3 presence คนจริง** (#50 / PR #62 merged, release PR #63): relay additive `pa` action stream · 8Hz publisher + fps valve · render-only GhostPose · tap-ghost GhostProfileCard · ghostGuard expansion. Relay deployed ✅; web goes live next main deploy. Full detail history v17.
- **R2.9 Codegen Asset Phase 1A** (#60 / PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Phase 1B (remaining ids) after owner eye-test.
- **#54 UI audit**: scorecard posted; owner questions still open — crit system / menu-row scope / action rail / chat overlay (gates Wave B ชุดที่เหลือ). R2.5–R2.8 detail → history v13–v15.

## Blockers / owed

1. **New-direction spec sign-off** — `docs/world-arc-freefield-v1.md` (PR from `r45/world-arc-freefield-v1`) awaits owner read/approve; slice 1 (free-field engine foundation) starts only after sign-off.
2. **Mobile gameplay/HUD direction** (#78) — R4 x/y mobile is not accepted yet; define portrait/landscape gameplay field, HUD collapse, touch targets, and tap affordance before calling mobile final.
3. **Old Wave 2 stack disposition** — comment/close #73, #74, #76 as superseded (owner call on closing); #79's Map2-reference framing is superseded by the reset (per-area references under World Arc v1 instead).
4. **Web deploy from `main`** — R3 block merged (PR #63); relay deployed ✅; **NO `prisma db push`**. Post-deploy spot check: bot-off default บน prod · 2 identities เห็นกัน ~8Hz · tap profile · relay-down degrade เงียบ.
5. Issue เปิดค้างรอ owner: **#60** (icon slice eye-test → เคาะ Phase 1B) · **#55** (ปิดได้ งานจบแล้ว) · **#54** (4 คำถาม: crit / menu-row / action rail / chat — crit answer gates R5 #52).

## Owner decisions affecting immediate work

- **Direction reset (2026-07-10)**: World Arc v1 + free-field 2.5D is the active map/field direction; x-axis-first model + Map2/Greenmill stack retired (`docs/world-arc-freefield-v1.md`, decision index rows added).
- R4.5 Wave 1 depth/scale/contact-shadow direction passed owner eye-test on 2026-07-10 (carried forward into free-field).
- R4 x/y mobile acceptance split to #78; do not block desktop work on lack of mobile design.
- References-first now applies **per arc area**: each area's visual pass waits for its own owner reference; the movement/field model does not wait on references.
- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- Owner: read/approve `docs/world-arc-freefield-v1.md`; decide close-vs-park for #73/#74/#76 and #79's framing.
- After sign-off: **Slice 1 — free-field engine foundation** (field rect as y domain, real 2D step for moveTo x/y, IRON invariant kept, lockstep + determinism tests, sim gates unmoved), then **Slice 2 — field board + tap-anywhere** = the smallest owner-testable vertical slice of the new model.
- Area visual passes wait on per-area owner references (attach in `docs/references/`, link from `docs/ui-reference-map.md`).
- R5 (#52) first PR = targeting metric flip — needs #54 crit answer; picks up after free-field slices 1–3. R6 (#53) Wave 1 (inert schema+server+API) can start any time on owner approval.
