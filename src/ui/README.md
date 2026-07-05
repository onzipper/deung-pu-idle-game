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

## Onboarding / FTUE (M4.8)

`src/ui/onboarding/` is a data-driven framework: `steps.ts` exports `ONBOARDING_STEPS` (typed `id` + optional `anchor` (a `data-onboarding-anchor="<value>"` DOM target) + an `advance` dismiss rule — `next` (explicit tap), `action` (auto-advances on a detected player intent), or `auto` (auto-advances once a pure predicate over the throttled snapshot is true)) plus the pure, headlessly-tested `resolveNextStepIndex`/`isFreshSave`. Progress (`onboardingStepIndex`, `ftueCompleted`) is a plain UI-owned `gameStore.ts` slice, localStorage-persisted like `soundMuted` (`// M5+: fold into server save`). `useOnboardingController.ts` wires the pure resolver to store snapshots; `OnboardingOverlay.tsx` renders the spotlight/tooltip and is mounted once in `GameHud.tsx`. **Later milestones (contextual per-system hooks, guide/codex, mascot) add behaviour by appending `ONBOARDING_STEPS` entries + matching `messages/*.json` `onboarding.steps.<id>` keys** — no other file should need changes for a new step.

## Codex / Guide (M4.8, "เปิดดูย้อนได้")

`src/ui/codex/` is a separate, always-reopenable reference (unlike the one-shot FTUE above), same data-driven philosophy: `entries.ts` exports `CODEX_CATEGORIES` + `CODEX_ENTRIES` (typed `id` + `category` + optional `contentRef` pointing at an existing engine-content id — `{ kind: "heroClass" | "upgradeStat", id }`) plus the pure `codexEntryRequiredKeys`/`codexEntriesByCategory` helpers, headlessly tested in `codex/__tests__/entries.test.ts` (asserts every required key resolves in BOTH message files, and that `contentRef` entries never redeclare a title). Body copy lives in a `codex` message namespace (`entries.<id>.title`/`.body`, `categories.<id>`, plus panel chrome keys); entries with a `contentRef` resolve their TITLE + ICON from the shared `content` namespace / `labels.ts` icon maps instead (never duplicated). `CodexPanel.tsx` renders the modal (grouped-by-category cards) and is mounted on-demand by `CodexButton.tsx` (settings row, `src/ui/components/`) — purely local `useState` open/close, no store field, and the sim is never paused behind it. The panel's "ดูบทช่วยสอนอีกครั้ง" button calls the store's `resetOnboarding()` action then closes itself, so `OnboardingOverlay` (which renders directly off `onboardingStepIndex`) retriggers immediately. **M5+ topics (gear/quests/items) add coverage by appending `CODEX_ENTRIES` (+ a new `CODEX_CATEGORIES` entry if needed) and matching `messages/*.json` `codex.entries.<id>` keys** — no other file should need changes for a new topic.
