# `engine/systems/` — per-step game logic

Each system is a pure function `(state, dt, ctx) => void | state'` invoked once per fixed step by the loop. Ported from the POC `UPDATE` / `SKILLS` blocks during M1. Planned systems:

- `movement` — heroes advance, enemies close in, positioning (melee front / ranged back)
- `combat` — attack timers, damage, death, kill → gold + XP, solo respawn (field-clear anti-stall)
- `hunt` — spawn schedule, per-zone/stage scaling (held while no hero is alive)
- `skills` — cooldowns + auto-cast (with the "no target in range" guard)
- `leveling` — kill XP → per-hero level (the primary power axis post-M5-pivot)
- `evolution` — player-triggered tier-2 class advancement (gold + level gate)
- `boss` — challenge flow, Slam (AOE) + Enrage, hint panel data, retreat-on-loss
- `stats` — derived hero atk/hp from class base + level + tier

**M5 Character Pivot:** the game is now a SINGLE character. The purchasable
`upgrades` system (atk/speed/hp lines) was REMOVED; the multi-hero formation/combat
engine is retained (it becomes the M8 party engine) but gameplay spawns exactly one
hero. See `docs/balance-m5.md`.

**Reminder:** no visual/particle code here. The POC `shockwave()` radius-goes-negative bug (`IndexSizeError`) and the `createRadialGradient` crash were *rendering* concerns — they live in `render/`, and clamping (`Math.max(0, …)`) belongs there.
