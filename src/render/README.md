# `render/` — PixiJS rendering layer

Reads `GameState` from the engine and draws it with PixiJS (WebGL). **One-way:** render reads engine state, never mutates it.

Chosen over raw Canvas 2D because Pixi gives us particles/filters/glow for free and sidesteps two POC rendering bugs entirely:

- `IndexSizeError` from `ctx.arc()` with a negative radius (the `shockwave()` ring bug). Pixi doesn't call `arc` directly; still, any radius fed to a Pixi Graphic must be clamped `Math.max(0, r)`.
- `createRadialGradient` + `addColorStop` crashing when a CSS var resolved empty. Use Pixi filters instead of manual gradients.

Runs outside React. The Pixi `Application` is created once (client-only, `useEffect`) and driven by the engine loop — it must **not** live in React state or re-render per frame.

## Public API (`GameRenderer.ts`)

```ts
import { GameRenderer } from "@/render/GameRenderer";

const renderer = new GameRenderer();
await renderer.create(canvasParent);       // once, client-only (e.g. inside a useEffect)
renderer.draw(state, frameEvents);         // every rAF; state is the engine's GameState,
                                            // frameEvents is this frame's sub-steps'
                                            // state.events concatenated by the caller
                                            // (see GameClient.tsx) — optional/defaulted
                                            // to [] for backward compatibility.
renderer.destroy();                        // on unmount
```

- `create(canvasParent: HTMLElement): Promise<void>` — async Pixi v8 `Application.init()`, appends `app.canvas` to `canvasParent`, builds the layer stack, and starts a `ResizeObserver` on `canvasParent` (Pixi's own `resizeTo` only reacts to `window` resizes, not layout-driven container resizes, so this class drives `renderer.resize()` itself). Idempotent — calling `create()` again tears down any previous instance first, and `destroy()` is safe to call before `create()` ever resolved. This covers React StrictMode's dev-mode mount/unmount/mount.
- `draw(state: GameState, frameEvents: GameEvent[] = []): void` — one-way read of engine state into Pixi display objects, then hands `frameEvents` to the `fx` layer's `FxController` (hit flashes, damage numbers, kill pops, screenshake, skill/boss VFX — see below) and advances every fx timer by a real-wall-clock `dt` computed from `performance.now()` deltas (NOT the sub-step count, so a 2x/3x speed multiplier never fast-forwards the juice itself). Must be called by the integration layer's rAF loop (this class does not run its own ticker against engine state). Never mutates `state` or the events it's handed.
- `destroy(): void` — full teardown: disconnects the resize observer, clears all entity pools, destroys the fx controller, the boss view/overlay, and the Pixi `Application` (`removeView: true` + children/texture cleanup).

### Scene layers (children of a `world` container, in this z-order)

`background` (static sky/ground/grid, drawn once) -> `entities` (heroes, enemies, boss) -> `projectiles` -> `fx` (M4 juice: damage numbers, particle bursts, expanding rings, full-arena flash — see `fx/` below; hit-flash itself tints entity views directly in `entities`, not this layer) -> `overlay` (screen-anchored arena readouts; currently just the boss HP bar + enrage label, POC-faithful — does not duplicate the React HUD).

`world` is scaled+letterboxed from a fixed logical coordinate space (`src/render/layout.ts`: `WORLD_WIDTH=900`, `WORLD_HEIGHT=300`, `GROUND_Y = CONFIG.layout.groundY`) to whatever pixel size the canvas actually is, so every view module draws in engine coordinates directly (no manual scaling math per shape) and resizing the container never rebuilds the scene.

### Entity views (`src/render/views/`)

Each is a pooled-by-id `Container` (see `Pool.ts`: mark-and-sweep per `draw()` call — created on first sight, destroyed once its id drops out of the frame's entity list; the scene graph is never rebuilt from scratch):

- `heroView.ts` — articulated adventurer silhouette colored by class (`theme.ts` `HERO_COLORS`; PROCEDURAL V2, task 86d3k2nj3): swordsman is armored (chest plate + pauldrons + open-face helm w/ plume + shield on the off-arm), archer is a hooded/cloaked figure with a quiver + a properly curved bow with a nocked arrow, mage wears a hemmed robe + belt + pointed hat and carries a staff with a layered-alpha glowing crystal head. Per-class weapon glyph (sword/bow/staff), HP bar, and a revive-countdown ring + label while `dead`. All detail work is extra draw calls into the SAME build-once `Graphics` objects (`torso`/`offArm`/`weaponArm`/`legBack`/`legFront`) — no new pooled display objects, no per-frame path rebuilding.
- `enemyView.ts` — kind-specific silhouette with per-kind personality (PROCEDURAL V2): `normal` a plain double-eyed wedge brute, `fast` a distinct low/sleek shape with an angry eye-slit, `tank` an armored block with plate seams + a heavy jaw, `ranged` a hooded kite with glowing eyes + a visible weapon tip — sized by `ENEMY_TYPES[kind].size`, colored by kind (`ENEMY_COLORS` stays a single hex per kind; shading/eyes/plates are flat black/white alpha overlays on that same hue, never a new per-kind palette entry). Body is drawn once per id (kind is immutable for an entity's life); only position + HP bar update per frame. Display-object budget unchanged (`body`/`legs`/`limbArm`/`hpBar`).
- `bossView.ts` — hexagon body topped with a crown/horns (tinting to the enrage accent while `boss.enraged`) + armor-plate seams + menacing eyes (brighten/redden with `boss.telegraph`/`boss.enraged`) — PROCEDURAL V2 — plus the pre-existing enrage tint and a closing "telegraph" ring that warns of the incoming slam while `boss.telegraph > 0`. The boss's own big HP bar + stage label lives in `GameRenderer`'s `overlay` layer (POC-faithful — that bar spans the top of the arena, not the boss's feet).
- `projectileView.ts` — `arrow`/`bolt` (shaft + head, rotated each frame to face the current target position) and `orb`/`meteor` (glow dot flying to a fixed impact point; `meteor` adds a falling trail). Colored by `kind` (`theme.ts` `PROJECTILE_COLORS`) — the POC colored by the firing hero's live type, but that identity isn't part of the pure engine's `Projectile` shape.
- `hpBar.ts` — the shared HP-bar drawer every view above uses (dark track + green/red fill, flips under 35%).

### The two POC bug rules, enforced here

- Every radius/size passed to a Pixi `Graphics` call is wrapped in `safeRadius()` (`theme.ts`, `Math.max(0, r)`) — see call sites in `hpBar.ts`, `enemyView.ts`, `bossView.ts`, `projectileView.ts`, `GameRenderer.ts`'s background/overlay bars.
- No hand-built canvas gradients anywhere; glow/soft edges (projectile halo, boss telegraph ring) are done with layered `alpha` on plain `Graphics` fills/strokes. Pixi filters (`pixi.js` built-ins, e.g. `ColorMatrixFilter`/`BlurFilter`) are the option to reach for once real bloom/glow is wanted — not manual `createRadialGradient`.

## `fx/` — M4 juice (event-driven, real-time, pooled)

`src/render/fx/FxController.ts` owns the `fx` layer's children and is the one-way consumer of a frame's collected `GameEvent[]` (see `engine/state/events.ts` and the collection contract in `GameClient.tsx`). Rule of thumb used throughout: **continuous/persistent** visuals (boss enrage aura, telegraph ring closing in) read `GameState` directly every frame in the relevant view module, same as HP bars; **edge-triggered, transient** juice (numbers, flashes, pops, shake) is driven from `consumeEvents()` here. All fx state is render-only and never touches `GameState`.

- `particles.ts` (`ParticlePool`) — one shared, fixed-size ring-buffer pool of `Graphics` dots backing every burst effect (kill pops, skill/meteor impacts, boss-defeated burst + gold shower, wave-spawn poof, hero-revive sparkle, boss-retreat puff). `burst()`/`shower()` are thin spawn helpers over it. Radii always `safeRadius()`-clamped.
- `floatingText.ts` (`FloatingTextPool`) — pooled, ring-buffer `Text` labels that rise + fade over a real-time duration. Two instances: damage numbers (cap 40, per spec) and a separate small "event text" pool (cap 16; kill/boss gold so it can't evict an in-flight damage number).
- `hitFlash.ts` (`HitFlashController`) — brief "flash to white" on the hit target's own view container via a `ColorMatrixFilter` (map-to-white matrix + the filter's own `alpha` driven 1 -> 0 as the mix uniform); filters are attached only while flashing and returned to a free-list after, so idle entities pay zero extra render cost. No hand-built gradients.
- `rings.ts` (`RingPool`) — pooled expanding/fading stroked-circle rings (swordsman spin cast, boss-telegraph intensify pulse, boss-slam-land shockwave). This is exactly the effect class the POC's negative-radius crash came from; every radius here runs through `safeRadius()`.
- `screenShake.ts` (`ScreenShake`) — exponential-decay amplitude + rotating direction; `GameRenderer` composes its `offset` ON TOP of the letterbox `baseTransform` every `draw()` (`applyWorldTransform()`), never overwriting the resize math. Mild on `heroDown`, strong on `bossSlamLand`; a retrigger takes the max amplitude, not a sum.
- `arenaFlash.ts` (`ArenaFlash`) — single reusable full-bleed rect for boss-enraged / boss-defeated / stage-advanced beats; peak-alpha kept subtle (~0.2-0.3) by design — no strobing.
- `FxController.ts` — wires the above to specific `GameEvent` types and exposes `consumeEvents(events, state)`, `update(dt)` (real seconds, never sub-step count — so 2x/3x speed never fast-forwards the juice), and `shakeOffset`.

`draw()` intentionally does not diff HP between frames to detect "just got hit" — the `hit` event carries that instead, which is the whole reason the event buffer exists.

## `environment/` — biome/background system (M4.5)

`src/render/environment/Environment.ts` owns the `background` layer end to end (replacing the old one-shot `drawBackground()`). It reads `state.stage`/`state.phase` and never anything else; render still reads engine state one-way.

- `biomes.ts` — pure data. Five `BiomeDef`s (`meadow -> forest -> cave -> volcanic -> frost`) plus `biomeForStage(stage)`, which cycles the list and hue-shifts a whole biome's palette (`colorUtils.shiftHue`) once per full loop through it (`stage 6` = meadow variant, not an identical repeat) — campaigns never "run out" of scenery without hand-authoring more raw palettes.
- `colorUtils.ts` — pure HSL/RGB math (`shiftHue`, `lerpColor`, `adjustLightness`). No canvas APIs at all; this is what keeps the "gradient" effects legal (flat-color rects lerped in JS, never `createRadialGradient`/`addColorStop`).
- `sky.ts` — `buildSkyBands()` / `buildHorizonGlow()`: a handful of stacked flat-color rects approximating a vertical gradient, built once. The sky itself does not scroll.
- `clouds.ts` — `CloudField`: a few overlapping-circle puffs drifting at a slow constant real-time pace, independent of game phase/speed — the calm atmospheric layer.
- `silhouettes.ts` — far-layer chunk builders (`buildSilhouetteChunk`), one per `SilhouetteShape` (`rolling-hills`/`treeline`/`jagged-rock`/`volcanic-ridge`/`frost-peaks`). `rolling-hills` samples a sine wave off each chunk's *global* x offset so adjacent chunks tile seamlessly; the jagged shapes are randomized-but-built-once (a seam there reads as terrain variety, not a bug).
- `groundBand.ts` — static ground band: base fill + top-edge highlight + baked (non-scrolling) speckle texture, built once per biome.
- `groundProps.ts` — near-layer scrolling foreground chunk builders (grass tufts / bush clumps / rock clusters / crystal shards / ember rocks), keyed by `biome.id`.
- `ParallaxLayer.ts` — the generic wrap-scroll primitive both `silhouettes.ts` and `groundProps.ts` ride on: builds N chunk `Container`s ONCE, then only repositions them every `update(dt, speed)` (`chunk.x -= speed*dt`; wraps by `+= chunkWidth*count` once fully off-screen). Zero allocation in steady state, by construction.
- `ambientParticles.ts` — `AmbientField`: perpetual (never-dying, wrap-forever) drifting particles per `AmbientKind` (`mote`/`leaf`/`dust`/`ember`/`snow`), a fixed small pool (density capped low; never meant to compete with combat for attention) — distinct from `fx/particles.ts`'s finite-life event-triggered bursts.
- `BiomeScene.ts` — wires one resolved biome's sky+clouds+far+ground+near+ambient+weather-tint into a single `Container`.
- `Environment.ts` — owns up to two `BiomeScene`s at once (`current` + `incoming`) and crossfades by alpha alone over 1s when `biomeForStage(state.stage).key` changes (covers both the `stageAdvanced` event and any other way stage could jump, e.g. a fresh load). Scroll pace for the far/near "world travel" layers is scaled by phase (`battle` fastest, `boss` calmest) — never by the 1x/2x/3x speed multiplier, so scenery motion stays wall-clock-real like the rest of `fx/`.

### Art direction (binding for hero/enemy animation tasks too)

- **Palette philosophy:** biome scenery stays desaturated and mid-to-low value (dusk/twilight ranges), deliberately close in luminance to the old flat `arenaSky`/`arenaGround`. Combat entities (`HERO_COLORS`, `ENEMY_COLORS`, fx accents) stay saturated jewel tones. That contrast is the whole readability strategy under chaos — scenery sets mood, entities read as "the important moving things." Hero/enemy sprite work should keep saturation high and reserve any biome-tinting to a *thin* rim-light/shadow accent in the current biome's `far.color`/`ground.accent`, never a wash over the whole sprite.
- **Silhouette shape language escalates with biome order:** rolling curves (meadow) -> tall jagged spikes (forest) -> sharp angular rock (cave) -> aggressive glowing-rim peaks (volcanic) -> sharp crystalline peaks (frost). This mirrors rising stage danger. Hero idle/march poses should read as grounded and rounded early (echoing meadow's calm), gaining sharper/faster silhouette breaks (weapon glints, more angular windups) as a run progresses; enemy silhouettes should get progressively spikier/more aggressive in the same arc, so a screenshot of any biome instantly signals "how far into the run" without reading numbers.
- **Motion grammar:** everything ambient (clouds, motes, leaves, snow) moves at a slow, constant, real-time pace — calm by design. Only the far/near parallax "world travel" layers speed up/slow down with phase. Hero marching animation should borrow this same distinction: a steady baseline gait (like the parallax) that visibly quickens the instant `phase === "battle"` engages, and eases during `boss` standoffs — keep hero locomotion tempo legible against the world's own tempo change rather than constant-speed.
- **No new gradients, ever:** every "soft" visual in this system (sky, horizon glow, glow rims, crystal glints) is layered flat-alpha rects/shapes or `tint`, per the POC-bug rule. Task 2/3 should keep reusing this vocabulary (layered alpha, not filters/gradients) for hit-glow, aura, or charge-up effects unless a Pixi filter is deliberately reached for.
- **Silhouette material vocabulary (PROCEDURAL V2, task 86d3k2nj3):** `theme.ts` adds three shared accents on top of the existing per-class/kind body hues — `HERO_COLORS[cls].shade` (a darker in-family tone for hoods/robes/armor recesses — the "2-3 flat tones per part" the shapes are built from), `PALETTE.steel` (neutral metal for blades/crossguards/arrowheads/staff bands, so armament reads as one material regardless of class), and `PALETTE.outline` (a thin near-navy stroke, not pure black, so armor/silhouette edges pop off scenery without turning into hard cutouts). Enemy kind personality (armor plates, angry eyes, hoods) reuses the SAME kind-coded body hue at layered black/white alpha rather than adding new per-kind palette entries — `ENEMY_COLORS` stays "colors are kind-coded, one hex per kind." **Known footgun:** `Graphics.arc(...).fill(...)` (as opposed to `.stroke(...)`) can collapse toward the path's stale pen position instead of the arc's own coordinates — build any filled curved cap from sampled points via `poly()` instead (see `heroView.ts`'s `arcFanPoints()`).
