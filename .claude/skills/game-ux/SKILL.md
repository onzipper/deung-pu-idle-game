---
name: game-ux
description: UX heuristics for ดึ๋งปุ๊ Idle Game UI work — consolidation, touch-first, copy tone, tooltip/juice conventions. Read BEFORE designing or briefing any HUD/panel/settings/interaction change in src/ui.
---

# Game UX — house rules (learned from owner feedback, not theory)

## Core principles (owner-confirmed)
1. **One mental model per feature.** Scattered toggles confuse players — consolidate controls that belong to one concept into ONE place with ONE master switch (e.g. bot = single switch + one settings modal; warp = single menu, no satellite shortcut buttons). When proposing UI, ask: "how many places does the player look?" Answer must be 1.
2. **Desktop AND mobile first-class** (owner directive 2026-07-06). Touch targets ≥44px (`min-h-11`), no hover-only affordances, panels scroll inside `max-h-[85vh]`, action bars reachable by thumb.
3. **Concise copy + ⓘ tooltips.** Labels = 2-4 Thai words. Explanations live in tooltips/hints (tap ⓘ on mobile), not in the label. Player-facing tone: casual Thai, กระชับ, no system jargon ("ตีบวก" not "refine level increment").
4. **Never make the player re-do a selection.** Action results must re-anchor state (see RefinePanel tap-to-skip + selection-follows-item). Repeated actions must be hammerable: animations skippable on tap, never a forced wait.
5. **Show progress + destination, always.** Any goal/quest/gauge: per-objective progress bar + plain-words "where to go" + one-tap "พาไปเลย" navigation when possible.
6. **Close-on-action.** Selecting the thing the modal exists for closes the modal (fast-travel pattern) — the player wants to SEE the result, not the menu.
7. **Automation UX ≠ automation intelligence.** Owner rejects "smart" auto-play (plays too well). UX may make automation easy to CONTROL, never better at PLAYING.

## Hard technical conventions
- Every modal renders through `ModalPortal` (iOS Safari backdrop-filter trap — see ModalPortal.tsx doc).
- Emoji: pre-2020 only (Windows 10 has no Unicode-13+ glyphs).
- i18n th/en complete for every string, namespaced; never hardcode.
- Engine is the validator: UI disabled-states are best-effort UX guards; engine rejects surface via NoticeToast.
- Prestige styling ladder exists (+8 gold-bright names, auras) — reuse it anywhere items/players are showcased.
- Narrow store selectors; intents via pendingInput drained once per frame.

## Theming
- Per-map theme anchors: map1 emerald forest / map2 crimson demonic / map3 bronze frontier / map4 ice blue / map5 desert gold / map6 infernal ember-on-black. Section headers/rows that reference a map should carry its accent (see FastTravelPicker).
- Desaturated scenery vs jewel-tone entities is the binding art direction (render/README.md) — HUD accents follow the entity palette, not the scenery one.

## Process
- Visual identity work (title/skin/fonts): NEVER build from imagination — owner rejected 3 attempts; start from owner-provided references only.
- Big UX changes: propose layout in words/ASCII first, get owner's เคาะ, then build.
- After building: flag anything not visually verified in-browser as "needs playtest" honestly.
