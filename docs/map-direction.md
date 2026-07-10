# Map direction — R4.5 "โลกมีมิติ, บางเบา" (owner-approved, issue #69)

The render-side art spec for how the 2.5D world reads. Binding for depth/biome
work; complements `src/render/README.md`'s art direction. Engine is untouched by
everything here — this is presentation only.

## Projection: C — "MMO field board with subtle depth" (LOCKED)

A gently raked field board (Ragnarok/idle-MMO feel): a fixed low camera, actors
stand on one ground plane, depth is a *whisper* of scale + a firm foot-sort. No
rotation, no true 3D (GDD).

- **A — flat side-scroller** (rejected): reads as a 1D lane, no "world" feel.
- **B — steep top-down/iso** (rejected): needs real tile occlusion + a rebuilt
  hit-test seam; too heavy, fights the fixed-camera hero rigs we already ship.

## Scale policy: cap, don't flatten (LOCKED)

- Depth scale band **0.95 (far) → 1.06 (near)** — capped from the old 0.8→1.12
  (a 40% swing that read as "randomly tiny", not "far"). See `depthBand.ts`.
- **Scale is a whisper; composition sells depth.** The size change only nudges
  the read — foot-sort + contact shadows do the real work.
- Vertical **offsets are unchanged** (−24 far / +40 near): position separation
  was never the problem, only the over-tuned scale. Band stays strictly monotonic.
- **Orthographic fallback trigger:** if capped scale ever reads as jitter on a
  dense screen (many actors, big depth spread), drop scale to a flat 1.0 and let
  offset + shadow + zIndex carry depth entirely. Not needed at 0.95↔1.06.

## Depth-cue priority (strongest → weakest)

1. **zIndex / foot-sort** — nearer actor always draws in front (`depthZIndex`).
2. **Contact shadow** — grounds the actor; makes the subtle scale read as depth. ← Wave 1
3. **Prop occlusion** — actors pass behind/in front of world props. *(Wave 3)*
4. **Path / terrain shape** — the ground plane curves/rakes the lane. *(existing terrain flag)*
5. **Foreground props** — near-layer parallax framing the board. *(Wave 2)*
6. **Far-row tint** — thin atmospheric desaturation on upstage actors. *(Wave 4)*
7. **Tap ping** — the tapped depth row confirms where a move landed. *(shipped, C2)*

## Wave plan

- **Wave 0 — direction (this doc + owner sign-off).** ✅
- **Wave 1 — capped depth scale + contact shadows (issue #69, THIS PR).** Scale
  cap 0.95↔1.06; a flat-alpha contact-shadow primitive (`views/entityShadow.ts`)
  under every actor. Render + docs only, no biome content.
- **Wave 2 — Map2: Greenmill Hamlet / Farm Border Road slice** (first biome
  under projection C; NOT this PR). Direction locked by the owner's World
  Direction Reference v1 board + Map2 Brief in issue #79. See spec below.
- **Wave 3 — prop occlusion** (actors sort against world props by foot line).
- **Wave 4 — far-row atmospheric tint + polish pass.**

## Wave 2 — Map2: Greenmill Hamlet / Farm Border Road (SPEC — Wave 2A, rewrite v2)

**Direction source (binding):** the owner's **World Direction Reference v1**
board + **Map2 Reference Brief** in issue #79. Those are style/direction
references and design tokens ONLY — never runtime assets, never copied 1:1.
This section translates them into the code-drawn implementation contract.

**Target: `map2` farm zones** (stages 6–10). Visual-only: no engine, no
collision, no hit-test targets, no image assets (layered flat-alpha primitives
per `render/README.md`).

### Direction summary

> A small farming hamlet at the edge of a darker forest. Warm and readable on
> the village/farm side, gradually more mysterious and dangerous toward the
> forest mouth.

- Mood ratio: **60% warm/safe · 30% mysterious forest edge · 10% early
  corruption hint**. NOT a dark forest, dungeon, hell gate, or otherworld.
- The player must read the progression at a glance:
  **hamlet/farm → broken road → lantern bend → forest mouth.**
- The main dirt road is the navigation anchor — readability first, always.

### Zone-progression mapping (interpretation (a) — OWNER-CONFIRMED 2026-07-10)

The reference board draws ONE composed map; engine map2 is FIVE separate
900-unit farm zones. The warm→mysterious progression spreads ACROSS the zones,
matching the mob-level gradient (owner confirmed (a) on PR #73; option (b)
"full composition per zone" was rejected — do not re-propose):

| Engine zone (stage) | Reference areas | Mood |
|---|---|---|
| 6 | A Greenmill Hamlet edge + B Golden Field | warm, human, farm soil |
| 7 | C Broken Cart Road | warm→uneasy, broken-cart landmark |
| 8 | D Lantern Bend | neutral, old lanterns + fence curve |
| 9 | E Forest Mouth (outer) | cooler, denser trees, bush/root edge |
| 10 | E Forest Mouth (deep) | darkest of map2, subtle purple; still not otherworld |

Cross-zone language in every zone: **F main dirt road** (continuous anchor),
**G old fence** (farm/forest boundary cue, fades out by zone 9–10),
**H tree clusters** (depth/occlusion tests — never over-occlude actors).

### Element list

1. **Ground composition (Wave 2B rework)** — main dirt road with a **gentle,
   natural curve** (the prototype's dramatic S-curve is superseded — it fought
   readability, per the Brief) + road-edge highlight (`ground.accent` family) ·
   terrain tone regions per zone: grass field / farm soil (warm zones), darker
   forest grass / root-bush edge (forest zones), stone patch accents · a
   **warm→cool-purple gradient along x AND across zones**, layered on the
   existing 2–3 depth value strips (max 3 unless owner approves more) · path
   fade near gates (existing gate-flatten rule) · **never pure-black far
   strips** (guarded by `wave2dReadability.test.ts` contrast floor).
2. **World props (Wave 2C rework)** — code-drawn from the board's prop set:
   wooden fence runs, broken cart (zone 7 landmark), old lanterns (zone 8 —
   gold flat-glow, no additive), sign post, stumps, bush clusters, small rocks,
   trees M/L, stone marker. **Authored zone-slot placement + deterministic
   jitter** replaces pure-hash scatter — the Brief is explicit: tune placement
   to the approved composition, don't let hash randomness decide the design.
   Density: hamlet/farm medium-low (human-made props) · road center sparse
   (combat/readability space) · forest mouth medium (tree/bush/root) · never a
   clutter wall across the actor band. Standing props keep the Wave-1.2 shared
   actor sort domain; foreground shin-strip covers feet/shins at most.
3. **Readability pass (Wave 2D rework)** — retune strip/road/prop knobs vs
   contact shadows against the NEW palette; silhouette-first (terrain must
   never out-contrast actors, damage numbers, HP bars, skill VFX); desktop
   first (mobile handled under the separate mobile-design issue per #79);
   day/evening/night all read per the board's lighting guide.

### Palette tokens (sanctioned exception)

Small explicit token set derived from the board's **Color Palette Guide**
(warm primary / mysterious secondary), used ONLY where deriving from the
existing biome palette cannot express the warm→cool progression. Tokens live
in one place (the forest-road/props modules' constants), documented, and
stay flat-alpha. No gradients/filters/additive, per render README.

### Design context ONLY — recorded for later waves, NOT implemented in Wave 2

- **NPCs** (placement/story direction only; no interactions, no sprites now):
  Auntie Nuan (farm owner), Lan the Lantern Keeper, Toma the Woodcutter,
  Silent Boy (hint character), Guild Scout.
- **Monsters** (engine content — separate issue): Farm Slime Lv.1–5 → Wild
  Boar → Goblin Looter → Wolf Pup → Cursed Mushroom → Vine Crawler → Shadow
  Wolf Lv.5–10; gradient warm→dangerous, never hellish/cosmic on map2.
- **Main quest chain** (separate issue): help Auntie Nuan → relight lanterns
  with Lan → follow the missing cart trail → investigate forest-mouth marks →
  unlock Map3: Old Forest Path.
- **Secret / Easter egg** (separate issue; NEVER in patch notes per the
  legendary rule): "The Lanterns Must Be Lit in Order" at Lantern Bend →
  Old Lantern Glow aura / Wick of the First Flame material. Legendary seed:
  Broken Cart Road clue reacting to Rusty Moon Key Fragment (lore direction
  only — no system work without explicit owner scope).

### Seam map (files each PR touches)

| Seam | File | Wave |
|---|---|---|
| Biome palette + propStyle | `src/render/environment/biomes.ts` | B (read), C (read) |
| Ground band composition | `src/render/environment/groundBand.ts` + `BiomeScene.ts` | B |
| Zone→terrain preset / gate flattening | `src/render/worldDepth/terrainZone.ts` | B (read/extend) |
| Ground line / foot line reads | `src/render/worldDepth/worldFxContext.ts` | B/C (read-only) |
| Prop vocabulary reference | `src/render/environment/groundProps.ts` | C (reference) |
| World-prop module (authored slots + jitter) | `src/render/environment/mapProps.ts` | C (rework) |
| Shared actor sort domain | `GameRenderer.ts` `entities` container | C (wiring, exists) |
| Gate/arch visual language | `src/render/environment/gateArch.ts` | C (reference) |
| Palette tokens (warm→mysterious) | forest-road/props module constants | B/C (new, small) |
| Depth cues / shadows tuning | `views/entityShadow.ts`, `worldDepth/depthBand.ts` (knobs only) | D |

### PR split & rework plan (stacked drafts, merge only on owner approval)

- **2A (this PR)**: this spec, rewritten against the #79 reference (v2).
- **2B rework** (base = 2A): ground per element 1 — gentle-curve road,
  per-zone tone regions, warm→cool gradient. Keeps the prototype's machinery
  (band-envelope strips, gate-fade, palette derivation, single-site map2-farm
  gating, build-once patterns).
- **2C rework** (base = 2B): props per element 2 — new inventory + authored
  slot placement. Keeps infra: deterministic placement helpers, shared
  sort-domain hosting, not-tappable proofs, pool isolation, road-path helpers.
  Occlusion RULES (MapProp model, layer priorities, testable "never hide
  combat feedback") remain **Wave 3**.
- **2D rework** (base = 2C): readability guards retuned to the new palette.
  Scale-policy PIN stays (Wave 1 PASSED — 0.95–1.06 locked). `current-state.md`
  re-worded (the prototype text assumed a merge that didn't happen).

### Owner eye-test checklist (Wave 2, desktop-first)

1. Progression reads at a glance: zone 6 feels like a warm farm; zone 10 feels
   like the mouth of something wrong — without ever going full-dark.
2. The main road is the first thing the eye finds in every zone; combat space
   around it stays open.
3. Farm side warmer/clearer; forest side cooler with a subtle purple tint —
   never too dark too early.
4. Landmarks anchor their zones: broken cart (7), lantern bend + fence curve
   (8), dense tree/bush mouth (9–10).
5. Props sort correctly against actors (front/behind); fence/tree clusters
   never hide damage numbers, HP bars, boss plate, or taps.
6. Contact shadows read on every tone region, day/evening/night.
7. Other maps + town + boss rooms byte-identical to before.
8. 60fps holds with the full slice (desktop; mobile later per its own issue).

## Rules

- **Props are visual-only.** No new collision, no engine state, no hit-test
  targets, no pathing — decoration the actors sort against, nothing more.
- Look-and-feel changes route through `sr-uxui-game-designer` / owner references,
  not reinterpreted here.
- No gradients / filters / additive blend for depth cues — layered flat alpha
  only (`render/README.md`).

## Owner eye-test checklist (Wave 1)

- Contact shadow reads under hero(es), enemies, boss, world boss, ghosts, NPCs.
- Shadow reads on BOTH bright (town/noon) and dark (night/cave) palettes — never
  a hard black cutout, never invisible.
- Far-row actors look "further", not "shrunk/broken", at the 0.95↔1.06 cap.
- Feet stay planted on the ground across the depth band (no floating shadows).
- Tap ping still lands on the tapped row after the scale cap.
- 60fps on desktop + mid mobile (shadows add one build-once Graphics per actor).
