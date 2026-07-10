# World Arc v1 + Free-field 2.5D Exploration — active direction (owner reset 2026-07-10)

> **This is a hard reset of the map/gameplay-field direction, not a patch to the
> old Map2 slice.** The x-axis-first field model and the Map2 "Greenmill Hamlet"
> design stack are **no longer active**. This document is the owner-facing spec
> for what replaces them. Old spec: `docs/map-direction.md` (Wave 1 depth rules
> in it still apply — see "What carries forward" below; the Wave 2 Map2 section
> is historical only).

## 1. What is replaced, what carries forward

### Replaced (no longer the design target)

- **x-axis-first field model** — the world as a left-to-right lane where the
  hero marches along x and y is a narrow cosmetic "depth band". The band model
  (home rows, scatter rows) was a stepping stone; it is not the destination.
- **Road as rail** — the main road as the *structural* spine the gameplay
  clings to. Roads stay, but as visual guides on an open field.
- **Map2 "Greenmill Hamlet / Farm Border Road" design** — the whole Wave 2
  slice (spec v2, S-curve ground prototype, prop reworks, readability polish).
  Owner did not accept it (#79); the reset supersedes it entirely.
- **PRs #73 / #74 / #75 / #76** — the stacked Wave 2 drafts. Status:
  **superseded / historical reference only.** Recommend closing #73, #74, #76
  with a "superseded by World Arc v1" comment (#75 already merged *into the
  stack branch*, never into `develop` — nothing from Wave 2 is in `develop`).
  Branches stay for archaeology; nothing from them merges as-is. Uncommitted
  Wave 2B prototype work is preserved in a labeled git stash on
  `r45/issue-69-wave2b-ground` (historical only).

### Carries forward (owner-passed or proven substrate — keep, do not redo)

- **Projection C — "MMO field board with subtle depth"** (locked): fixed low
  camera, no rotation, no true 3D. Free-field exploration lives *inside* this
  projection.
- **Wave 1 depth language** (owner eye-test PASSED): depth scale band
  0.95↔1.06, contact shadows under every actor, foot-sort via `depthZIndex`.
  These are exactly the cues a free field needs — they get *more* important,
  not less.
- **Wave 1.2 shared sort domain**: heroes/enemies/ghosts already interleave in
  one sortable `entities` container by foot row. This is the free-field actor
  sorting model already working.
- **R4 x/y plumbing (C1 + C2)**: `FrameInput.moveTo {x, y?}` (lockstep-proven,
  relay-opaque), `stepPlaneY` easing, tap→depth inversion (`tapToPlaneY`),
  dash-to-row. The free field is built ON this substrate — R4 was not wasted;
  it built the pipes. What changes is the *width of the world those pipes
  serve*.

## 2. World Arc v1 — the ten areas

The world is one journey from the safe human edge to an otherworld climax.
Each area has one job in the arc; mood darkens progressively — no area skips
ahead of its place (the old rule stands: no hell/cosmic imagery in early areas).

| # | Area | Identity | Mood beat |
|---|---|---|---|
| 1 | **Capital Outskirts** | town gate / safe human edge | safe, warm, populated |
| 2 | **Farm Border Road** | farm road at the forest edge | working land, first hints of wild |
| 3 | **Old Forest Path** | deeper forest road | shaded, quiet, watchful |
| 4 | **Moonshade Grove** | misty magical forest | beautiful-strange, first magic |
| 5 | **Forgotten Shrine** | ruined shrine / chapel in the woods | melancholy, sacred-broken |
| 6 | **Hollow Ravine** | abyss-root ravine / broken terrain | danger, vertigo, broken ground |
| 7 | **Crystal Fault** | corrupted crystal wilds | alien growth, wrong colors |
| 8 | **Ashen Gate** | burnt frontier / infernal gate edge | scorched, hostile, oppressive |
| 9 | **Otherworld Verge** | dimensional borderland | reality thinning, dreamlike dread |
| 10 | **Rift Sanctum** | final rift sanctuary / otherworld climax | climax, otherworldly grandeur |

### How the arc meets the existing engine content

Today the engine has **6 maps + asura appendix** (`CONFIG` map list: map1–map6,
5 zones × 900 units each, stages 1–30). The arc is the *target world*; the
mapping of arc areas → engine map ids/stages is a **data/naming decision to
make in the arc-scaffolding PR, with owner sign-off** — options are re-theming
the existing 6 maps to arc areas 1–6 and appending 7–10 later, or regrouping
stages across 10 maps. Either way it is naming/theme/id data only: **stage
balance, enemy stats, boss gates, and progression pacing do not move** as part
of this direction (rebalance, if ever, is its own owned decision).

### Art rule (unchanged, now per-area)

**References-first** stands and is now per-area: each area's visual pass waits
for an owner-approved reference for THAT area. No area visuals get invented
from text. The movement/field model below does NOT wait on references — it is
geometry and input, provable on placeholder ground.

## 3. Free-field 2.5D movement model

### The one-sentence version

> Each map is an open 2.5D field: the player clicks/taps any reachable point
> and the hero walks there; roads guide the eye, not the feet; depth comes
> from where your feet are.

### Coordinates — how the map works conceptually

- A map is a **2D world-space play area**: `x` runs across the map (as today),
  `y` is the **ground-plane depth position** (the hero's feet on the ground,
  far ↔ near). Both are first-class engine position axes.
- The current "depth band" generalizes into the **field rect**: per-map bounds
  `x ∈ [0, fieldWidth]`, `y ∈ [fieldFar, fieldNear]`. Wave-era `bandFar/bandNear`
  becomes a *field* that is tall enough to explore, not a strip actors scatter in.
- **Rendering stays projection C**: world `(x, y)` maps to screen via the
  existing seam — depth offset + subtle 0.95↔1.06 scale from `y`, camera fixed.
  No renderer rewrite; the board just gets taller and the ground is drawn to
  cover it.
- Engine stays pure/deterministic: positions are plain numbers stepped at
  fixed dt; no physics engine, no navmesh library.

### Click/tap-to-move

- Player clicks/taps a point on the field → renderer inverts the projection
  (generalized `tapToPlaneY`, one handler desktop+mobile as today) → world
  `(x, y)` → **clamped to the reachable area** → issued as the existing
  `moveTo {x, y}` manual command. Move ping renders at the tapped spot
  (already plumbed via `moveOrdered {x, y?}`).
- Unreachable/blocked point → resolve to the **nearest reachable point**
  (v1: clamp to field rect; later: clamp against the walkable mask). Never
  reject a tap silently.
- Hero walks a **straight line to the target** (both axes easing together —
  x speed + `stepPlaneY` already exist; unify into one 2D step so diagonal
  speed is honest, not x-speed-plus-free-y).
- AUTO/bot behavior keeps its dumb-automation character: bots pick engagement
  positions in the field the simple way; no smart kiting (owner rule).
- No virtual joystick (locked decision) — tap-to-move + AUTO remain the model.

### Actor depth sorting

- **Foot position IS depth**: an actor's `y` (feet on the ground plane) drives
  `depthZIndex` — lower on screen = nearer = drawn in front. This already
  works (Wave 1 + Wave 1.2 shared `entities` sort domain) and is unchanged in
  principle; it simply becomes load-bearing everywhere instead of within a
  narrow band.
- **World props join the same sort domain** by their foot line (this was
  "Wave 3 occlusion" in the old plan — the concept survives; props are
  siblings in the sortable container, so actors pass in front of / behind
  them naturally). Combat feedback (damage numbers, HP bars, boss plate,
  taps) must never be hidden by props — keep the old test-guarded rule.
- Ghosts keep the Wave 1.1/1.2 model: live `py` from presence rides the same
  sort; absent-y peers keep deterministic scatter fallback.

### Walkable / blocked areas — represented later, designed now

Phased so the field model never blocks on authoring tools:

1. **v1 — field rect** (this direction's first slice): everything inside the
   per-map rect is walkable. Zero authoring cost, already provable.
2. **v2 — walkable polygon(s) per map**: a small, hand-authored list of convex
   polygons (or one concave outline) in engine config per map — pure data,
   deterministic, versioned with the map. Tap clamp = nearest point inside.
   This shapes fields (a ravine edge, a lake, a shrine platform) without tiles.
3. **v3 — prop/terrain blockers**: props and terrain features can register
   blocked shapes (circles/rects) subtracted from the walkable area. Authored
   placement (a lesson kept from Wave 2C: authored slots + deterministic
   jitter, never pure-hash randomness deciding design).
- Explicitly NOT: tile grids, navmesh baking, physics colliders. Movement is
  straight-line + clamp; if a blocked shape is in the way, v2/v3 may simply
  stop at the boundary (idle-game tolerance — perfect pathfinding is not a
  goal and "dumb" movement fits the game's automation character).
- All walkable data lives engine-side (`engine/config`, per map) so engine,
  bots, and party lockstep share one truth; render only draws it.

### Combat / targeting

- **Short term**: the IRON invariant stays — `y` does not gate combat;
  targeting/range stay x-based, so combat behavior and balance sim are
  untouched while the field opens up.
- **Long term (R5, #52)**: targeting metric flips to true 2D distance — that
  is already R5's planned first PR and is where the invariant is deliberately
  retired, with a full balance-sim re-adjudication (never-downgrade zone).
- **Rule for all new code starting now: do not assume x-only.** New systems
  take `(x, y)` positions and distance helpers, even while combat still reads
  x — so the R5 flip is a metric change, not a rewrite.

## 4. Recommended implementation sequence

Each step is one PR-sized slice, engine determinism rules and docs-sync rule
apply to all; nothing merges without owner review. Visual/art passes are gated
per-area on references and are NOT in this sequence.

| # | Slice | Layer | Contents |
|---|---|---|---|
| 1 | **Free-field foundation** ← *recommended first implementation PR* | engine | Per-map field rect replaces the narrow band as the y domain; hero movement becomes a real 2D step (straight-line to `moveTo {x,y}`, honest diagonal speed); all intake clamps target the field rect. IRON invariant kept; lockstep hash-equality + determinism tests; SAVE_VERSION reviewed (expect additive/none — positions already exist). Sim gates must hold unmoved. |
| 2 | **Field board + tap-anywhere** | render/ui | Ground plane drawn to the full field rect under projection C (placeholder tones, no art); tap→world inversion generalized to the taller field, desktop + mobile; move ping at tapped point. Owner-testable: "I can click anywhere and walk there." |
| 3 | **Enemy/NPC field placement** | engine | Spawns/idle positions become 2D points in the field (deterministic, seeded-RNG rules respected); engagement approach stays dumb. Combat still x-gated. |
| 4 | **World Arc scaffolding** | engine data | Arc area names/ids/theme hooks for the 10 areas + the owner-signed mapping to existing maps/stages. Naming/data only — zero balance movement. |
| 5 | **Walkable polygon v1** | engine + render | Per-map walkable outline data + tap clamp + move stop-at-boundary; one map shaped as proof. |
| 6 | **Prop foot-sort + blockers** | render, then engine data | Props in the shared sort domain (old Wave 3 concept) and, later, prop blocker shapes. |
| — | Area visual passes (1 → 10) | render | Each gated on that area's owner reference. |
| — | R5 targeting flip (#52) | engine | Picks up after slices 1–3; needs the #54 crit answer as before. |

### Smallest useful vertical slice (prove the model)

**One existing map, full-rect walkable, placeholder ground**: slices 1 + 2 on
a single map — click/tap any point on a taller field, hero walks there in
x+y, foot-sort and contact shadows keep depth reading correctly, enemies
fight exactly as today. No art, no arc content, no walkable authoring. If that
feels right in the owner's hands, the field model is proven and everything
else is layering.

## 5. Standing constraints (unchanged by this reset)

- Engine purity/determinism, seeded RNG for wave composition only, save
  changes via `SAVE_VERSION` + `migrate()`.
- No relay protocol changes without explicit scope; `moveTo` extensions ride
  the opaque `FrameInput` (proven pattern).
- Desktop + mobile first-class for every interaction (mobile gameplay/HUD
  *design* remains its own open issue, #78).
- Flat-alpha code-drawn art rules per `render/README.md`; no gradients/
  filters/additive for depth cues.
- Never merge to `main` without per-merge owner confirm; balance gates hold
  on every engine-touching slice.
