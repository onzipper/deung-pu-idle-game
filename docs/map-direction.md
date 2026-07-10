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
- **Wave 2 — Forest Road biome slice** (first biome under projection C; NOT this
  PR). See content list below.
- **Wave 3 — prop occlusion** (actors sort against world props by foot line).
- **Wave 4 — far-row atmospheric tint + polish pass.**

## Wave 2 — Forest Road slice content (NOT implemented here)

Visual-only, no engine/collision changes:

- Raked forest-road ground plane (path narrowing toward the horizon) via the
  existing terrain seam.
- Layered tree props: far treeline silhouette, mid trunks, near foreground trunks
  framing the lane.
- Foliage ambient (drifting leaves) tuned for the road.
- Row tint calibration so far-lane mobs desaturate slightly into the treeline.
- Contact shadows (Wave 1) verified against the raked ground.

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
