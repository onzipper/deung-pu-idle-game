# `engine/` — Game simulation (pure TypeScript)

The single source of truth for game state. **Pure TS: no DOM, no canvas, no React, no Pixi, no Next.** Everything here must run headless (Node/Vitest) so we can unit-test combat and run balance simulations without opening a browser — this is how the nasty POC bugs (meteor not exploding, sword out of reach, gradient script errors) get caught.

## Contract

The engine is a state transformer:

```
step(state: GameState, dt: number, input: FrameInput): GameState
```

- Deterministic given the same `(state, dt, input)` and RNG seed.
- No side effects, no I/O, no wall-clock reads (`Date.now()` lives at the boundary, not here).
- `render/` reads `GameState` to draw; `ui/` reads a throttled snapshot via Zustand. Neither writes to it except through engine entry points.

## Layout

| Folder | Responsibility |
|---|---|
| `core/` | Fixed-timestep loop + accumulator, seeded RNG, math helpers |
| `config/` | Tunable balance constants (ported from the POC `CONFIG` block) |
| `state/` | `GameState` type, `SaveData` schema, `SAVE_VERSION`, `migrate()` |
| `entities/` | Hero / enemy / projectile type definitions |
| `systems/` | movement, combat, hunt, skills, leveling, evolution, boss — the per-step logic |
| `__tests__/` | Headless unit tests + balance-sim harness |

## Rules

1. Import boundary is enforced by ESLint — importing `react`, `pixi.js`, `next`, or `zustand` here fails lint.
2. Use the fixed-timestep loop in `core/`; never step on a variable `dt`. Speed multipliers = more sub-steps, not a bigger `dt`.
3. Bump `SAVE_VERSION` and add a `migrate()` branch whenever `SaveData` changes shape.
