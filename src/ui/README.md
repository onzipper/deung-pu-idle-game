# `ui/` — React HUD, menus, panels

React components for everything around the game canvas: gold/level HUD, upgrade panel (atk/speed/hp + auto toggle), skill bar (+ auto-cast toggle), boss hint panel, speed selector.

- `components/` — the React components (built in M2).
- `store/` — the Zustand store. React reads game numbers from a **throttled** engine snapshot (~10 Hz), never from a per-frame subscription. See `store/gameStore.ts`.

UI dispatches player intent (buy upgrade, cast skill, set speed) into the engine; it does not run game logic itself.

## i18n

UI strings live in `messages/th.json` / `messages/en.json` (next-intl, cookie-based — see `src/i18n/`); components call `useTranslations("<namespace>")`. `hud`/`panels`/`common` hold HUD copy; `content` holds game-content display text keyed by the engine's own stable ids.

**Adding a new content entity** (class/skill/upgrade now; quest/item later, namespaces already reserved as `{}`):
1. The engine already exposes a stable id (e.g. `HeroClass`, `keyof Upgrades`) — never add a display string to `engine/config`.
2. Add `content.<type>.<id>.name` (and `.desc` if needed) to BOTH message files.
3. In the component, resolve it with `useTranslations("content")` + a template key: `t(\`classes.${cls}.name\`)`. Icons stay in `src/ui/labels.ts` (visual, not translatable).
