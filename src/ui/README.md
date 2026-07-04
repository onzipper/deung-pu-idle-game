# `ui/` — React HUD, menus, panels

React components for everything around the game canvas: gold/level HUD, upgrade panel (atk/speed/hp + auto toggle), skill bar (+ auto-cast toggle), boss hint panel, speed selector.

- `components/` — the React components (built in M2).
- `store/` — the Zustand store. React reads game numbers from a **throttled** engine snapshot (~10 Hz), never from a per-frame subscription. See `store/gameStore.ts`.

UI dispatches player intent (buy upgrade, cast skill, set speed) into the engine; it does not run game logic itself.
