# Context Pack — UI Layer (`src/ui/**`, `src/app/**`)

## Purpose

React HUD, menus, and panels around the Pixi canvas: gold/level HUD, base-stat panel, skill bar, quest/goal tracker, inventory/equipment, town NPC panels, settings, Hall of Fame, party/friends, chat, world map. UI dispatches player intent into the engine (`pendingInput` queue) and never runs game logic itself — it reads a throttled (~10Hz) Zustand snapshot of `GameState`, not a per-frame subscription.

## Current shape (post R2.5, "fullscreen render + all-overlay HUD")

- Fullscreen canvas (`page h-dvh`, canvas `absolute inset-0`) — the old framed 3:1 layout was deleted.
- Dark Fantasy + Gold + Purple design system, primitives in `src/ui/components/primitives/` (`Panel`, `Button`, `Tab`/`TabRow`, `CurrencyChip`, `StatBar`, `ItemTile`, `Toast`, `IconTileButton`, `ConfirmPopup`) — gold = numbers/edges/CTA only, body text is always ink-colored (contrast rule).
- HUD composition lives in `src/ui/components/GameHud.tsx`: top-left `HeroPortraitCard.tsx` + buffs, top-right `CurrencyChipsRow.tsx` + `IconTileButton` menu row + `MiniMapCard.tsx`, left-mid `GoalLadderOverlaySlot.tsx` (portals `GoalLadder.tsx`), bottom-center `SkillDock.tsx` (wraps `SkillBar.tsx` + `BotMasterSwitch.tsx` + `ConsumableBar.tsx`, collapsible), bottom-edge `ExpClockStrip.tsx`. `GameHud.tsx` documents the full z-index ladder — read it before adding a new overlay element.
- `ModalPortal.tsx` is **mandatory for every new modal** — iOS Safari treats an ancestor `backdrop-filter` as a containing block for `position:fixed` children, so any modal not portaled to `document.body` will clip/misposition on iOS.
- FTUE (`src/ui/onboarding/`) anchors DOM elements via `data-onboarding-anchor="<value>"` + `useAnchorRect.ts` (poll/resize based `querySelector`). Anchors were re-pointed in R2.5 (`stat-panel`→`character-menu`, `settings-row`→`menu-row`).

## Read first

1. `src/ui/README.md` — full layer contract (goal ladder, settings drawer, i18n pattern, FTUE, codex, gear).
2. CODEMAP `src/ui/` sections (components, primitives, store, world, gear, hof, onboarding) — paste the relevant subsection into an agent brief rather than exploring.
3. `docs/ui-reference-map.md` — binding owner decisions on every panel's shape (do not re-litigate items marked "เคาะแล้ว").
4. First files to inspect for most tasks: `src/ui/components/GameHud.tsx`, `src/app/(game)/GameClient.tsx` (the rAF/intent-drain seam), `src/ui/store/gameStore.ts` (the engine↔React bridge).

## Tests to run

```
pnpm test src/ui
```
Key suites: `src/ui/components/__tests__/gameHudLayout.test.tsx` (fullscreen/FTUE-anchor RTL smoke), `src/ui/components/__tests__/questTracker.test.tsx` (GoalLadder tabs), `src/ui/store/__tests__/gameStore.test.ts`, `src/ui/store/__tests__/questTrackerCollapsed.test.tsx`, `src/ui/gear/__tests__/` (12 files, inventory/equip/refine-reveal logic), `src/ui/onboarding/__tests__/` (FTUE step resolution), `src/ui/hof/__tests__/`, `src/ui/world/__tests__/` (gate/npc trip state machines).

## Known risks

- FTUE anchors resolve via `querySelector` on `[data-onboarding-anchor]` — a **hidden duplicate** (e.g. an off-viewport copy of a component) breaks the anchor. Always portal instead of show/hide-duplicate a component that carries an anchor.
- Desktop AND mobile must both work for every UI/interaction change (owner standing directive) — check both in any render-affecting change.
- Windows 10 has no Unicode-13+ emoji glyphs — icons must be pre-2020 emoji or CSS/SVG-drawn (`src/ui/components/icons.tsx`).
- Gear/item lookups: never bare-index `ITEM_TEMPLATES[id]` — legendary/fortifier items live outside that table; use `lookupTemplate`/`ALL_ITEM_TEMPLATES` (3 shipped bugs from this class; auto-sell's absence-skip is a deliberate, documented exception).
- New content ids (class/skill/quest/item) need entries in **both** `messages/th.json` and `messages/en.json` — coverage is test-enforced for gear (`src/ui/gear/__tests__/itemI18n.test.ts`) and codex (`src/ui/codex/__tests__/entries.test.ts`).

## Do not touch

- `pendingInput` drain semantics in `src/app/(game)/GameClient.tsx`/`src/app/(game)/soloFrameDrain.ts`: one-shot intents (moveTo, castSkill, etc.) must drain **only on stepping frames** (>0 sub-steps). A prior bug drained-before-computing-steps and silently discarded intents on 0-step frames (90Hz+ displays, ~guaranteed on the first rAF after boot) — this is a whole bug class, not a one-off.
- Never resurrect `UpgradePanel`/"upgrade" copy or a player-facing speed selector — both were deliberately removed (M5/M6.7).
- Automation config UI (`BotSettingsModal.tsx`) must stay the ONE home for auto-* config — don't scatter new bot toggles elsewhere.
