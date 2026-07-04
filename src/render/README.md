# `render/` — PixiJS rendering layer

Reads `GameState` from the engine and draws it with PixiJS (WebGL). **One-way:** render reads engine state, never mutates it.

Chosen over raw Canvas 2D because Pixi gives us particles/filters/glow for free and sidesteps two POC rendering bugs entirely:

- `IndexSizeError` from `ctx.arc()` with a negative radius (the `shockwave()` ring bug). Pixi doesn't call `arc` directly; still, any radius fed to a Pixi Graphic must be clamped `Math.max(0, r)`.
- `createRadialGradient` + `addColorStop` crashing when a CSS var resolved empty. Use Pixi filters instead of manual gradients.

Runs outside React. The Pixi `Application` is created once (client-only, `useEffect`) and driven by the engine loop — it must **not** live in React state or re-render per frame.

Skeleton only; the render layer is built in M2.
