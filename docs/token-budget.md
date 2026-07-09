# Token budget

How much context an agent may read **before proposing a plan**. The routing files
(`AI.md`, `docs/feature-map.md`, `docs/CODEMAP.md`) exist so you can find the right
files without crawling `src/`.

## Small task
(label/copy change, single knob, one-component tweak, doc fix)

- Read: `README.md`, `AI.md`, `docs/current-state.md`, ONE context pack, affected files.
- **No more than 5 files before proposing a plan.**
- No repo-wide grep sweeps; use `docs/CODEMAP.md` to locate the file.

## Medium task
(new panel, new intent, bot behavior, endpoint change)

- Read: `docs/current-state.md`, the `docs/feature-map.md` entry, the context pack,
  affected implementation files + their tests, `docs/known-traps.md` sections that match.
- Write a short plan before editing: touched systems, test commands, deploy impact
  (web / relay / db push / none).

## Large task
(new system, engine change, schema change, cross-layer refactor)

- Write a **discovery note first** (what exists, what changes, risks) — do not implement immediately.
- Read the relevant design doc(s) in `docs/` + the engine/testing packs.
- **Owner confirmation required** before any broad refactor, engine-determinism change,
  schema change, or relay protocol change.

## Always

- History (`docs/history/`) is off-budget — read only when current-state points there.
- Long docs: read the relevant section, not the file.
- Cite files by path; don't paste large file bodies into plans.
