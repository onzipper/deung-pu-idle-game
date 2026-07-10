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
- **Wave 2 — Forest Road biome slice** (first biome under projection C).
  **2A ✅ 2B ✅ 2C ✅ 2D ✅** (issue #69) — see content list below.
- **Wave 3 — prop occlusion** (actors sort against world props by foot line).
- **Wave 4 — far-row atmospheric tint + polish pass.**

## Wave 2 — Forest Outskirts / Dark Forest Road vertical slice (SPEC — Wave 2A)

**Target: `map2` farm zones** (the forest biome family, `propStyle: "bush"` in
`environment/biomes.ts`). One map only — the pattern generalizes to other biomes
after the owner signs off the slice. Visual-only: no engine, no collision, no
hit-test targets, no image assets (layered flat-alpha primitives per
`render/README.md`).

### Element list (what "authored" means for this slice)

1. **Ground composition (Wave 2B ✅)** — the playable band stops being one flat
   fill: 2–3 horizontal depth tone strips (far strip darkest, colors derived
   from the biome's existing `ground.base/band` palette — no new hex constants
   where a `shiftHue`/darken of the biome palette works), plus a **dirt-road
   S-curve** crossing the band from far-left toward near-right (edge-highlight
   per the flat-tone vocabulary, using `ground.accent`). Road flattens/fades at
   gates per the existing `terrainZone` gate-flattening rule.
2. **World props (Wave 2C ✅)** — code-drawn, deterministic placement (stateless
   hash on zone+index, same policy as everything else — never the wave RNG):
   4–6 trees (trunk column + canopy mass), 3–4 rocks, low grass clumps,
   1 lamp post (gold flat-glow halo, no additive), 1 wooden sign, 1 broken
   gate/arch reusing the `gateArch` visual language. Props that stand ON the
   band carry a `footY`-derived zIndex and join the Wave-1.2 **shared actor
   sort domain** (`entities` container) so actors walk in front of/behind them.
   A thin **foreground grass strip** at the near edge may cover feet/shins only.
3. **Readability pass (Wave 2D ✅)** — tune strip/road alphas vs contact shadows,
   verify mobile portrait/landscape legibility, damage-feedback never occluded,
   day/night palettes both read; tests + docs sync. Fixed a real contrast bug:
   the far depth-tone strip's darken amount (`forestRoad.ts`'s
   `STRIP_FAR_DARKEN`) clamped to pure `0x000000` on map2's darkest farm
   zones (HSL lightness floor via `adjustLightness`) — a near-black contact
   shadow over a literally-black strip has zero luminance delta, so the
   shadow melted in completely. Reduced `0.12` → `0.05` (comfortable
   non-zero floor on every map2 farm zone, both noon and deep-night palettes
   — test-pinned in `src/render/__tests__/wave2dReadability.test.ts`).

### Seam map (files each PR touches — identified in 2A, modified later)

| Seam | File | Wave |
|---|---|---|
| Biome palette + propStyle | `src/render/environment/biomes.ts` | B (read), C (read) |
| Ground band composition | `src/render/environment/groundBand.ts` + `BiomeScene.ts` | B |
| Zone→terrain preset / gate flattening | `src/render/worldDepth/terrainZone.ts` | B (read/extend) |
| Ground line / foot line reads | `src/render/worldDepth/worldFxContext.ts` | B/C (read-only) |
| Prop vocabulary to promote | `src/render/environment/groundProps.ts` | C (reference) |
| NEW world-prop module (depth-sorted) | `src/render/environment/mapProps.ts` (new) | C |
| Shared actor sort domain | `GameRenderer.ts` `entities` container | C (wiring) |
| Gate/arch visual language | `src/render/environment/gateArch.ts` | C (reference) |
| Depth cues / shadows tuning | `views/entityShadow.ts`, `worldDepth/depthBand.ts` (knobs only) | D |

### PR split & dependency chain (stacked drafts, merge only on owner approval)

- **2A (this PR)**: this spec + seam map. Docs only.
- **2B** (base = 2A): ground composition only — tone strips + road, `map2`
  zones only. No props, no occlusion.
- **2C** (base = 2B): world props, visual-only, deterministic placement,
  shared-sort-domain zIndex. No collision, no gameplay reads. Full occlusion
  RULES (the `MapProp` data model, layer priorities, "never hide combat
  feedback" as a testable rule) remain **Wave 3** — 2C ships the minimum
  footY-sort behavior only.
- **2D** (base = 2C, ✅): readability/mobile polish, alpha/knob tuning within
  the locked scale policy, tests + docs. Knob change: `forestRoad.ts`'s
  `STRIP_FAR_DARKEN` `0.12 → 0.05` (see the Wave-2D bullet above). Added a
  scale-policy PIN test (`worldDepth/__tests__/worldDepthDepthBand.test.ts`)
  and a combined cross-module readability guard
  (`src/render/__tests__/wave2dReadability.test.ts`): shadow-vs-strip
  contrast (noon + deep-night), foreground-strip shin bound, prop-density
  bound across all 5 map2 farm zones, and the near-grass-strip/road overlap
  seam (structural — the strip's blade-tip apex never rises above the near
  depth-tone strip's own top).

### Per-PR eye-test items

- **2B**: forest zones read as an authored field (strips + road) on mobile +
  desktop · road flattens at gates · town/boss/other maps byte-identical ·
  night palette keeps the road visible but calm.
- **2C**: hero/mobs/ghosts walk in FRONT of far props and BEHIND near trunks ·
  foreground grass covers shins at most · no prop hides damage numbers/HP ·
  gate/NPC taps unaffected (props are not tappable).
- **2D**: combined slice reads at a glance on mobile portrait · shadows sit
  correctly on strip boundaries · no readability regression in the other maps.

## Rules

- **Props are visual-only.** No new collision, no engine state, no hit-test
  targets, no pathing — decoration the actors sort against, nothing more.
- Look-and-feel changes route through `sr-uxui-game-designer` / owner references,
  not reinterpreted here.
- No gradients / filters / additive blend for depth cues — layered flat alpha
  only (`render/README.md`).

## Owner eye-test checklist (combined Wave 2 slice — 2A-2D, issue #69)

Supersedes the earlier Wave-1-only list — Wave 1 (contact shadows + the scale
cap) is folded in below since 2D's fixes touch both.

- **Ground + road (2B)**: map2 farm zones read as an authored field (3 tone
  strips + the dirt-road S-curve), on mobile portrait/landscape AND desktop;
  road flattens toward both walk gates; every other map/zone stays
  byte-identical.
- **Props (2C)**: 4-6 trees, 3-4 rocks, 1 lamp (warm glow, no additive), 1
  sign, 1 broken gate fragment scatter naturally per zone; hero/mobs/ghosts
  walk in FRONT of far props and BEHIND near trunks; the foreground grass
  strip covers feet/shins at most, never a knee or higher.
- **Contact shadow (1, re-verified after 2D's strip fix)**: reads under every
  actor (hero, enemies, boss, world boss, ghosts, NPCs) on TOP of the new
  ground strips specifically — no strip tone (especially the far/darkest
  strip on map2's demon-realm zones) swallows the shadow into a flat black
  smear.
- **Day/night**: cycle through เช้า/เที่ยง/ค่ำ/กลางคืน (or force the phase) and
  confirm the road, strips, props, AND the shadow all still read at the
  darkest (กลางคืน) extreme — never a hard cutout, never invisible.
- **Depth scale cap**: far-row actors/props look "further", not
  "shrunk/broken", at the LOCKED 0.95↔1.06 band; feet stay planted (no
  floating shadows or props) across the whole depth band.
- **No occlusion regressions**: no prop ever covers a damage number, HP bar,
  or the boss HP plate; gate/NPC taps land correctly (props are never
  tappable); tap ping still lands on the tapped row.
- **Perf**: 60fps holds on desktop + mid mobile with the full slice active
  (strips + road + ~13-15 props + grass + shadows, all build-once).
