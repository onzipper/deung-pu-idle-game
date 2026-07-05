# `ui/` — React HUD, menus, panels

React components for everything around the game canvas: gold/level HUD, base-stat panel (STR/DEX/INT/VIT + auto-allocate toggle), skill bar (mana costs, per-skill auto-cast slotting, class-change quest affordance), boss hint panel, speed selector.

**M5 Character Pivot note**: the old gold-bought atk/speed/hp upgrade lines (`UpgradePanel`, `panels.upgradesLabel`/`upgradeAriaLabel`/`autoUpgradeToggle`) are GONE — a solo hero's power now comes from level + base stats (`StatPanel.tsx`, `allocateStat` intent) + class/skills (`SkillBar.tsx`, mana + cooldown + up to 3 auto-cast slots) + the class-change quest (tier 1 -> 2). Don't resurrect "upgrade" copy/components for this system; see `docs/GDD.md`/`docs/ROADMAP.md` for the current vision.

- `components/` — the React components (built in M2).
- `store/` — the Zustand store. React reads game numbers from a **throttled** engine snapshot (~10 Hz), never from a per-frame subscription. See `store/gameStore.ts`.

UI dispatches player intent (allocate stat, cast skill, set auto-cast slot, accept/complete the class-change quest, set speed) into the engine; it does not run game logic itself.

## i18n

UI strings live in `messages/th.json` / `messages/en.json` (next-intl, cookie-based — see `src/i18n/`); components call `useTranslations("<namespace>")`. `hud`/`panels`/`stats`/`common` hold HUD copy; `content` holds game-content display text keyed by the engine's own stable ids.

**Adding a new content entity** (class/skill now; quest/item later, namespaces already reserved as `{}`):
1. The engine already exposes a stable id (e.g. `HeroClass`, skill id) — never add a display string to `engine/config`.
2. Add `content.<type>.<id>.name` (and `.desc` if needed) to BOTH message files.
3. In the component, resolve it with `useTranslations("content")` + a template key: `t(\`classes.${cls}.name\`)`. Icons stay in `src/ui/labels.ts` (visual, not translatable).

## Onboarding / FTUE (M4.8, reworked M5 Character Pivot)

`src/ui/onboarding/` is a data-driven framework: `steps.ts` exports `ONBOARDING_STEPS` (typed `id` + optional `anchor` (a `data-onboarding-anchor="<value>"` DOM target) + an `advance` dismiss rule — `next` (explicit tap), `action` (auto-advances on a detected player intent), or `auto` (auto-advances once a pure predicate over the throttled snapshot is true)) plus the pure, headlessly-tested `resolveNextStepIndex`/`isFreshSave`. Progress (`onboardingStepIndex`, `ftueCompleted`) is a plain UI-owned `gameStore.ts` slice, localStorage-persisted like `soundMuted` (`// M5+: fold into server save`). `useOnboardingController.ts` wires the pure resolver to store snapshots; `OnboardingOverlay.tsx` renders the spotlight/tooltip and is mounted once in `GameHud.tsx`. **Later milestones add behaviour by appending `ONBOARDING_STEPS` entries + matching `messages/*.json` `onboarding.steps.<id>` keys** — no other file should need changes for a new step.

The player arrives at the FTUE having already created a character and picked a class on `/characters`, so the current 8-step sequence teaches the SOLO-hero loop end to end: `welcome` (class-aware mascot greeting, `content.classes.<cls>.name` passed as an ICU `{className}` var into every step's `t()` call) → `watchFight` (first kill, anchored `kill-progress`) → `allocateStats` (spend a level-up stat point, anchored `stat-panel`, `action: "allocateStat"` — detected as a hero's `str+dex+int+vit` sum rising, since a level-up alone only grants points, never spends them) → `castSkill` (manual mana+cooldown cast, anchored `skill-bar`) → `slotAutoSkill` (tap a skill's `+ Auto` badge, `action: "setAutoSlot"` — an auto-slot fill count rising) → `bossChallenge` → `settingsTour` (now also name-checks the codex/guide button) → `outro`. The old gold-upgrade-era `watchGrow` placeholder step is gone.

**Contextual tips** (`tips.ts`, same registry pattern, own `CONTEXTUAL_TIPS` + `useContextualTips.ts`): `heroDeathRespawn`, `autoCastAvailable`, `questOffered` (class-change quest first offered, Lv.15), `questComplete` (quest objectives met — the "เปลี่ยนคลาส!" button), `autoSlotUnlocked` (a hero's unlocked auto-slot count just rose, Lv.15/30), `statPointsPiling` (>9 unspent stat points while auto-allocate is off), `stageClear`, `bossWipe` — registry order is fire-priority when several trigger the same tick. Both registries share `OnboardingSnapshot`/`toOnboardingSnapshot` (`steps.ts`): a hero's `statsSum`/`statPoints`/`unlockedSlots`/`autoSlotsFilled`/`questOffered`/`questComplete` are precomputed there from the store's fuller `HeroSummary` shape so the pure trigger/advance predicates only ever compare cheap primitives.

## Codex / Guide (M4.8, "เปิดดูย้อนได้", reworked M5 Character Pivot)

`src/ui/codex/` is a separate, always-reopenable reference (unlike the one-shot FTUE above), same data-driven philosophy: `entries.ts` exports `CODEX_CATEGORIES` + `CODEX_ENTRIES` (typed `id` + `category` + optional `contentRef` pointing at an existing engine-content id — `{ kind: "heroClass", id }`) plus the pure `codexEntryRequiredKeys`/`codexEntriesByCategory` helpers, headlessly tested in `codex/__tests__/entries.test.ts` (asserts every required key resolves in BOTH message files, and that `contentRef` entries never redeclare a title). Body copy lives in a `codex` message namespace (`entries.<id>.title`/`.body`, `categories.<id>`, plus panel chrome keys); entries with a `contentRef` resolve their TITLE + ICON from the shared `content` namespace / `labels.ts` icon maps instead (never duplicated). `CodexPanel.tsx` renders the modal (grouped-by-category cards) and is mounted on-demand by `CodexButton.tsx` (settings row, `src/ui/components/`) — purely local `useState` open/close, no store field, and the sim is never paused behind it. The panel's "ดูบทช่วยสอนอีกครั้ง" button calls the store's `resetOnboarding()` action then closes itself, so `OnboardingOverlay` (which renders directly off `onboardingStepIndex`) retriggers immediately. **M5+ topics (gear/quests/items) add coverage by appending `CODEX_ENTRIES` (+ a new `CODEX_CATEGORIES` entry if needed) and matching `messages/*.json` `codex.entries.<id>` keys** — no other file should need changes for a new topic.

Categories today: `coreLoop`, `character` (M5: `characterSlots`, `baseStats`, `manaSkills`, `classQuest` — the systems that replaced the old team + upgrade lines), `heroes` (per-class `contentRef` entries), `boss`, `controls` (`gameSpeed`, `autoCast`, `autoAllocate`), `offlineIdle`.
