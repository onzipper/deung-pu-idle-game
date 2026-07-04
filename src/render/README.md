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

- `heroView.ts` — stick figure colored by class (`theme.ts` `HERO_COLORS`), per-class weapon glyph (sword/bow/staff), HP bar, and a revive-countdown ring + label while `dead`.
- `enemyView.ts` — kind-specific silhouette (`normal`/`fast` wedge, `tank` block, `ranged` diamond) sized by `ENEMY_TYPES[kind].size`, colored by kind, + HP bar. Body is drawn once per id (kind is immutable for an entity's life); only position + HP bar update per frame.
- `bossView.ts` — hexagon body, enrage tint (`boss.enraged`), and a closing "telegraph" ring that warns of the incoming slam while `boss.telegraph > 0`. The boss's own big HP bar + stage label lives in `GameRenderer`'s `overlay` layer (POC-faithful — that bar spans the top of the arena, not the boss's feet).
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
