# Context Pack — Engine Layer (`src/engine/**`)

## Purpose

The single source of truth for game state. Pure TypeScript simulation core: `step(state: GameState, dt: number, input: FrameInput|PartyInput) -> GameState` advances exactly one fixed timestep. Deterministic given the same `(state, dt, input)` and RNG seed — this determinism is what makes party lockstep, offline-idle replay, and the balance sim all possible. Runs headless (Node/Vitest) so combat/skills logic is testable without a browser.

## Hard rules (ESLint-enforced where possible)

1. **No DOM/React/Pixi/Next/Zustand imports** in `engine/**` — importing any of `react`, `pixi.js`, `next`, `zustand` here fails lint. No wall-clock reads (`Date.now()`) except the one sanctioned read in the day/night draw path (render-side, not engine — engine itself never reads wall-clock).
2. **Seeded RNG stream** (`core/rng.ts`, mulberry32) is reserved for **wave/spawn composition only**. Combat/skills/drops must never draw from it — they use `core/hash.ts`'s stateless splitmix32 hashing (`lootHash`/`lootFloat`) or fixed offset tables instead, so replay/lockstep never desyncs on draw order.
3. All tunables live in `engine/config/` (`CONFIG` in `index.ts`, plus `items.ts`, `refine.ts`) — this is what the balance sim sweeps.
4. Save shape changes go through `SAVE_VERSION` bump + a `migrate()` branch in `src/engine/state/version.ts`. Check that file for the current value — never hardcode it in docs.
5. Fixed-timestep loop in `core/loop.ts` — never step on a variable dt; "speed" = more sub-steps per frame, never a bigger dt.
6. `state.events` (`src/engine/state/events.ts`) is per-step, transient, deterministic, and **cleared every step** — render/audio must collect events across ALL sub-steps of a frame before drawing, never rely on the accumulated-across-frames buffer.

## Read first

1. `src/engine/README.md` — the layer contract in full.
2. CODEMAP `src/engine/core/`, `src/engine/state/`, `src/engine/config/`, `src/engine/systems/` sections — paste the relevant subsection into an agent brief.
3. Key files for most tasks: `src/engine/core/step.ts` (the one transition, wires every system), `src/engine/state/index.ts` (`GameState`/`SaveData` shape), `src/engine/config/index.ts` (`CONFIG`), `src/engine/systems/hunt.ts` (spawn pool), `src/engine/systems/skills.ts` (skill kits), `src/engine/systems/gear.ts` (equip + drop rolls), `src/engine/lockstep/turnLoop.ts` + `stateHash.ts` (party lockstep + the desync canary).

## Tests to run

```
pnpm test src/engine
pnpm test src/engine/lockstep
```
Determinism/hash-equality suites to never break: `src/engine/__tests__/determinism.test.ts`, `src/engine/__tests__/float-determinism-guard.test.ts`, `src/engine/lockstep/__tests__/lockstep.test.ts` (multi-client hash-equal over thousands of turns). Also run the canonical balance sim after any tunable/behavior change (see [economy.md](./economy.md)).

## Depth plane / y at spawn (R4 Wave A)

The engine owns each entity's **ground-plane depth row**: `Entity.planeY` (optional on `Hero`/`Enemy`/`Boss`), assigned once at spawn by `systems/plane.ts` and configured under `CONFIG.plane`. It is the world-y OFFSET (relative to the ground line; 0 = on the line) an entity sits at for its depth — a stateless id-hashed scatter (`hashUnit` → `planeYForDepth`) for mobs, the class formation row for a solo hero (party fans by lockstep slot), the near/downstage row for bosses.

- **Provenance**: the band + hero rows are a VERBATIM port of `render/worldDepth/{depthBand,depthAssign}.ts` (the engine may not import render). `CONFIG.plane.bandFar/bandNear/heroBand*/formationDepth` mirror `DEPTH_OFFSET_FAR/NEAR` + `HERO_*_DEPTH`; a parity test in `plane.test.ts` pins the engine values. Keep the two in lock-step.
- **Determinism**: pure FNV-1a of the entity id — never the wave RNG, never a wall-clock. Same id → same `planeY` on every client, so it is folded into `stateHash` (present-only) as a divergence canary.
- **Wave A is behaviour-neutral**: `planeY` is UNUSED by combat/movement/targeting (combat stays x-based on the ground line) and by render placement (render still computes its own depth). The legacy `Entity.y` (the render torso-anchor that `hit`/`fastTravel` events carry) is untouched.
- **No SAVE bump**: the live entity arrays are never persisted, so `planeY` is recomputed at spawn on every load (transient, like `command`/`aimX`). Proven in `plane.test.ts`.
- **Wave B / R4-R5 handoff**: render will read `entity.planeY` in place of recomputing depth; the x/y milestone will MOVE entities along it (ease at `CONFIG.plane.ySpeed`, unused today). Cohort builders that stand up a >1-hero party should set `hero.planeY = heroPlaneY(cls, slot, size)` to reproduce render's party fan (`makeHero` defaults to the solo row).

## Known risks

- Any change that touches ordering, RNG draw sites, or floating-point paths risks a **desync** between party lockstep clients — the hash-equality tests in `src/engine/lockstep/` are the guard; treat a failure here as a stop-everything bug, not a flaky test.
- New `ProjectileKind`/enum members need their render map entries (`PROJECTILE_COLORS` etc. in `src/render/theme.ts`) added in the **same change**, or the client crashes at runtime ("Unable to convert color undefined").
- Gear-only template lookups (`ITEM_TEMPLATES[id]`) miss legendary/fortifier items — see `src/engine/config/items.ts`'s companion lookup helpers.

## Do not touch

- Never draw from `core/rng.ts`'s seeded stream inside combat/skills/drop-roll code paths — it is reserved for wave composition.
- Never add a wall-clock read (`Date.now()`) inside `step()` or any `systems/*.ts` file — the day/night cycle's `Date.now()` read is the one sanctioned exception and lives in `render/worldDepth/`, not here.
- Never bump `SAVE_VERSION` without a corresponding `migrate()` branch in `src/engine/state/version.ts`.
- Never change a tuned curve/constant in `config/` without running the balance sim first (see [economy.md](./economy.md)) — these are load-bearing, not cosmetic.
