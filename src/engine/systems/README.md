# `engine/systems/` — per-step game logic

Each system is a pure function `(state, dt, ctx) => void | state'` invoked once per fixed step by the loop. Ported from the POC `UPDATE` / `SKILLS` blocks during M1. Planned systems:

- `movement` — heroes advance, enemies close in, positioning (melee front / ranged back)
- `combat` — attack timers, damage, death, kill → gold
- `waves` — spawn schedule, per-wave/stage scaling
- `skills` — cooldowns + auto-cast (with the "no target in range" guard)
- `upgrades` — 3 stat lines (atk / speed / hp), per-line cost curves, auto-upgrade
- `boss` — challenge flow, Slam (AOE) + Enrage, hint panel data, retreat-on-loss

**Reminder:** no visual/particle code here. The POC `shockwave()` radius-goes-negative bug (`IndexSizeError`) and the `createRadialGradient` crash were *rendering* concerns — they live in `render/`, and clamping (`Math.max(0, …)`) belongs there.
