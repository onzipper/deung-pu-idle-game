# Current state

> **Rule: update this file every round** (same commit as the round's close-out). When a
> round is superseded, append the old block to `docs/history/claude-status-log.md` —
> never let this file grow into a log. Target: short enough to read every session.

_Last updated: 2026-07-11 (free-field epic PR #81 implemented — phases 1–6 complete, Draft awaiting owner playtest)._ 

## Where we are

- **Arc**: Open World MMO (GDD v3) — R1 new look ✅ → R2 UI sweep ✅ → R2.5–R2.9 ✅ → R3 presence คนจริง ✅ (merged + relay deployed) → R4 engine x,y CODE-COMPLETE (substrate KEPT) → R4.5 Wave 1 depth language ✅ (owner-passed, KEPT) → World Arc v1 + Free-field 2.5D spec ✅ (PR #80 merged, owner-approved) → **ACTIVE: free-field implementation epic — Draft PR #81 (`r45/freefield-epic-v1`), phases 1–6 ALL implemented, awaiting owner playtest of the playable slice**. Later: 2D combat targeting flip + shared elites as later epic phases.
- **Workflow (owner 2026-07-11)**: old issue stack closed/superseded; work opens **only as a large Epic or large implementation PR** with phases inside — no micro-task issues.
- **Branches**: `main` = R3 block (PR #63). `develop` = spec merge (PR #80). `r45/freefield-epic-v1` = the epic (Draft PR #81).
- **Suite**: **2510 tests green** at epic close-out (49 new), tsc/eslint clean, production build passes. Patch notes current: 2026-07-10e (R3 presence — epic patch notes come at merge time).

## Latest work

- **Free-field epic implemented (Draft PR #81, 2026-07-11)** — the playable vertical slice of `docs/world-arc-freefield-v1.md`, 6 phases in one big PR: **P1 engine foundation** (`fieldRect(mapId)` seam; band −24/40 → **−64/56** = field height 120, render constants parity-synced; manual `moveTo {x,y}` = honest straight-line 2D at huntSpeed via `dhypot`, diagonal never faster, both axes snap at one arriveEps gate; every intake clamps through the field rect) · **P2 field board** (WORLD_HEIGHT 300→312 decorative headroom; new `HORIZON_Y` — sky/silhouettes moved up so far-row actors stand on ground; opaque ground base fill covers the full field every zone; tap-anywhere spans the field via the formula-driven seams; ping at tapped row) · **P3 placement** (enemy scatter fills the widened band deterministically; NPCs get engine-owned `planeY`; interactions stay x-only, pinned) · **P4 World Arc scaffolding** (`config/worldArc.ts` dormant 10-area table; 1:1 map1–6 mapping documented for owner review; asura outside the arc) · **P5 walkable v1** (optional per-map polygon + nearest-reachable clamp — never silent-fail; squared-distance math, no navmesh; no live map uses one yet) · **P6 field props foundation** (`fieldProps.ts` props in the shared foot-sort domain; combat feedback can never be hidden — layer order + non-tappable + interleave all test-pinned; blocker data hook dormant). **IRON invariant intact throughout — y never gates combat; sim gates unmoved (verified in-suite + two independent agent sim runs). SAVE_VERSION 20 untouched; relay/DB untouched.**

- **DIRECTION RESET — World Arc v1 + Free-field 2.5D** (owner 2026-07-10, approved conceptually 2026-07-11): the x-axis-first field model and the Map2 "Greenmill Hamlet" design are retired — hard reset, not a patch. New spec: `docs/world-arc-freefield-v1.md` — world = 10 areas (Capital Outskirts → Farm Border Road → Old Forest Path → Moonshade Grove → Forgotten Shrine → Hollow Ravine → Crystal Fault → Ashen Gate → Otherworld Verge → Rift Sanctum); field = free-field 2.5D (click/tap any reachable point, real x/y positioning, road = visual guide, depth from foot position, walkable data phased in later). KEPT: projection C + Wave 1 depth language (owner-passed) + Wave 1.2 shared sort domain + all R4 x/y plumbing. SUPERSEDED (factual status): old Wave 2 PRs #73/#74/#76 **closed**; #75 merged into the stack branch only, never into develop; the whole old planning-issue stack **closed as superseded/not planned**. Wave 2B WIP preserved in a labeled stash on `r45/issue-69-wave2b-ground`. Decision index, map-direction, ROADMAP (M8.15), docs README synced.
- **Owner eye-test verdicts (2026-07-10)**: R4.5 Wave 1 depth/scale/contact-shadow direction **passed**. R4 x/y mobile experience not accepted yet — there is no approved mobile gameplay/HUD design; that design question now folds into the future epic plan (its old tracking issue is closed) and does not block desktop work.
- **R4.5 Wave 1.2 — ghost/actor depth interleave**: GhostLayer roots now live INSIDE the shared `entities` sortable container (siblings of hero/enemy roots) — one `depthZIndex(d)` domain, so ghosts/heroes/enemies interleave by row · sort key branches on new `worldFx.depthEnabled()` seam accessor: depth ON → band zIndex; depth OFF → `GHOST_FLAT_ZINDEX −11000` (pre-depth "ghosts under party" order preserved byte-for-byte) · combat hit-test inherently ghost-free (`hitTestPointer` scans engine `state.enemies`/worldBoss, never container children); `hitTestGhost` intact · hero-vs-enemy sorting verified already-correct (test-pinned now) · Wave-1.1 behaviors all preserved (live planeY/fallback/shadow/fade/pose pulses) · NEW `ghostInterleave.test.ts` (7 tests) · note: ghosts now take the actor night-tint instead of scenery ambientTint (peer-actor treatment — owner passed Wave 1 overall; keep future tint changes explicit).
- **R4.5 Wave 1.1 — ghost live planeY + manual y hold** (follow-up from owner eye-test): (1) presence `p` payload gains additive `py` (`Math.round(hero.planeY)`, only-when-finite; `v:1` unchanged, no new opcode) → `ghostStore` parses to `planeY: number|null` (missing/malformed → null never 0; band-clamped) with its OWN ease anchor clock (`planeYAt` — separate from `lerpAt` which `pa` re-stamps at 8Hz and would freeze the row) → `ghostLayer` uses `item.planeY ?? scatterPlaneY(cid)` (absent-y peers byte-identical; contact shadow rides the live row) · **relay audit: `handlePresence` forwards payload verbatim (v-check + 256B cap only) → NO relay deploy** · ghostGuard extended with py-garbage variants, still green. (2) engine: transient `Hero.planeYHold` — set when a move-with-y arrives (both axes), cleared by x-only move completion + zone arrival; steering priority = engaged-mob lane > active command.y > `hold ?? home`; boss/worldBoss → `hold ?? home` never boss row · in stateHash present-only · **SAVE_VERSION stays 20** (`toSaveData` asserted clean) · combat first-hit/kill ticks byte-identical with hold active · sim unmoved.
- **R4 Wave C2 manual x/y + dash y + tap plumbing** (last R4 code step): `FrameInput.moveTo` gains optional `y` (additive; x-only byte-identical) — clamped to `[bandFar, bandNear]` at EVERY input path (intake, town walk, dash landing; non-finite y = absent) · hunt-phase + town MOVE command steers `planeY` to command.y via `stepPlaneY`, clears only when BOTH axes arrive · `dashHeroTo` lands on a farm mob's row via `enemyDashPlaneY` (boss/worldBoss → undefined → row unchanged, C1 rule); 3 ninja call sites plumbed · tap→planeY: `hitTestMath.tapToPlaneY` inverts `depthOffsetY`, one arena handler desktop+mobile, engine re-clamps · `moveOrdered` event gains optional `y` (move ping at tapped depth); `heroDashed` unchanged (streak at fixed HERO_MID_Y, hero view follows live planeY) · **relay OPAQUE, no protocol change — proven**: JSON round-trip + wired-vs-direct LockstepClient hash equality + mixed x-only/x-y 2-client 800-turn run · SAVE_VERSION stays 20 · sim gates unmoved.
- **R3 presence คนจริง** (PR #62 merged, release PR #63): relay additive `pa` action stream · 8Hz publisher + fps valve · render-only GhostPose · tap-ghost GhostProfileCard · ghostGuard expansion. Relay deployed ✅; web goes live next main deploy. Full detail history v17.
- **R2.9 Codegen Asset Phase 1A** (PR #61 merged): SVG icon language 9-id slice, `src/ui/components/icons/` registry + `ItemIcon`/`SkillIcon` seam, labels.ts glyph = verbatim fallback. Remaining icon ids = future epic-scoped work (its old tracking issue is closed).
- **UI audit (closed round)**: 64-row scorecard was posted and the audit issue closed with the old stack; unresolved design questions (crit system, menu-row scope, action rail, chat overlay) fold into the future combat/UI epic phases — no open issue holds them.

## Blockers / owed

1. **Owner playtest of PR #81** (Draft) — the playable slice: click/tap anywhere → hero walks in real x/y → depth/shadow/sort read correctly → combat unchanged. Desktop first; check day/night, town, boss rooms, ghosts. Merge only on owner confirm.
2. **Owner decision queued in PR #81**: arc→map mapping default is 1:1 (map1–6 → areas 1–6); open question — map6's hell-city theme reads closer to area 8 Ashen Gate (pure data swap either way, nothing reads it yet).
3. **Web deploy from `main`** — R3 block merged (PR #63); relay deployed ✅; **NO `prisma db push`**. Post-deploy spot check: bot-off default บน prod · 2 identities เห็นกัน ~8Hz · tap profile · relay-down degrade เงียบ.

## Owner decisions affecting immediate work

- **Direction reset (2026-07-10, approved conceptually 2026-07-11)**: World Arc v1 + free-field 2.5D is the active map/field direction; x-axis-first model + Map2/Greenmill stack retired (`docs/world-arc-freefield-v1.md`, decision index rows added).
- **Big-epic workflow (2026-07-11)**: old issue stack closed/superseded; future work must be opened only as a large Epic or large implementation PR, with phases inside it. Do NOT create micro-task issues unless the owner explicitly asks.
- R4.5 Wave 1 depth/scale/contact-shadow direction passed owner eye-test on 2026-07-10 (carried forward into free-field).
- Mobile gameplay/HUD design is still undefined — resolve it inside the epic plan; it does not block desktop work.
- References-first now applies **per arc area**: each area's visual pass waits for its own owner reference; the movement/field model does not wait on references.
- R2.5 เคาะ: NPC walk-order HUD buttons SUPERSEDE the older no-HUD-shop rule (recorded in `docs/ui-reference-map.md`).
- `RefineButton` kept unused pending owner confirm.
- Docs discipline (commit `ea26997`): CODEMAP synced on every file add/delete/move — test-enforced.

## Do not touch right now

- `src/lab/**`, `src/render/views/heroView.ts`, `public/lab-assets/**` when the owner's parallel lab session is active (check `git status` first).
- Engine determinism zones, DB schema, relay protocol — no changes without explicit owner scope.

## Next recommended work

- Owner: playtest the PR #81 slice; answer the arc-mapping question; merge confirm when it feels right.
- After merge: patch notes for the free-field slice (i18n th+en) + a real shaped walkable polygon on one map (design-driven) + per-NPC depth stagger (taste pass).
- Area visual passes wait on per-area owner references (attach in `docs/references/`, link from `docs/ui-reference-map.md`).
- 2D combat targeting flip = a later epic phase (crit design question gets answered there) — substrate is now fully in place.
