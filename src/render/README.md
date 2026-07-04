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
await renderer.create(canvasParent);  // once, client-only (e.g. inside a useEffect)
renderer.draw(state);                 // every rAF; state is the engine's GameState
renderer.destroy();                   // on unmount
```

- `create(canvasParent: HTMLElement): Promise<void>` — async Pixi v8 `Application.init()`, appends `app.canvas` to `canvasParent`, builds the layer stack, and starts a `ResizeObserver` on `canvasParent` (Pixi's own `resizeTo` only reacts to `window` resizes, not layout-driven container resizes, so this class drives `renderer.resize()` itself). Idempotent — calling `create()` again tears down any previous instance first, and `destroy()` is safe to call before `create()` ever resolved. This covers React StrictMode's dev-mode mount/unmount/mount.
- `draw(state: GameState): void` — one-way read of engine state into Pixi display objects. Must be called by the integration layer's rAF loop (this class does not run its own ticker against engine state). Never mutates `state`.
- `destroy(): void` — full teardown: disconnects the resize observer, clears all entity pools, destroys the boss view/overlay, and destroys the Pixi `Application` (`removeView: true` + children/texture cleanup).

### Scene layers (children of a `world` container, in this z-order)

`background` (static sky/ground/grid, drawn once) -> `entities` (heroes, enemies, boss) -> `projectiles` -> `fx` (empty in M2 — **the M4 juice hook**: hit-flash, screenshake, particle bursts, kill pops all mount here) -> `overlay` (screen-anchored arena readouts; currently just the boss HP bar + enrage label, POC-faithful — does not duplicate the React HUD).

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

## What's deliberately NOT here yet (M4)

`fx` layer is present but empty. Hit-flash tinting, screenshake, kill-pop bursts, particle systems, and skill/boss cast VFX are M4 juice — they hook into `fx` (and/or per-view tint) once Framer Motion / Pixi particles / GSAP land, per `CLAUDE.md`'s milestone plan. `draw()` intentionally does not diff HP between frames to detect "just got hit" — that kind of transient, render-only animation state is exactly what M4 adds, kept out of `GameState`.
