/**
 * Codex/Guide registry (M4.8) — the DATA-DRIVEN core, same philosophy as
 * `ui/onboarding/steps.ts`: pure TS (no React/DOM), so shape/i18n-coverage
 * invariants are headlessly testable (`__tests__/entries.test.ts`).
 *
 * "เปิดดูย้อนได้" (reviewable any time) — unlike the one-shot FTUE, the codex
 * is just a static reference the player can reopen from the settings row at
 * any point in the run. Body copy lives in `messages/*.json`'s `codex`
 * namespace; entries that document an existing engine-content id (hero
 * class) resolve their TITLE + ICON from the shared `content`
 * namespace / `labels.ts` icon maps instead of duplicating them here (see
 * `contentRef`) — only the codex-specific BODY explanation is new copy.
 *
 * FUTURE MILESTONES (M5+ gear/quests/items) add coverage by APPENDING
 * `CODEX_ENTRIES` entries (+ a `CODEX_CATEGORIES` entry if it's a new
 * category) and matching `messages/*.json` "codex.entries.<id>" keys —
 * no other file's shape should need to change. See `src/ui/README.md`.
 */

import type { HeroClass } from "@/engine";

export type CodexCategoryId =
  | "coreLoop"
  | "character"
  | "heroes"
  | "boss"
  | "controls"
  | "offlineIdle";

export interface CodexCategoryDef {
  id: CodexCategoryId;
  /** i18n key: `codex.categories.<id>` (namespace "codex"). */
}

/** Points an entry's TITLE + ICON at an existing content-id's display data
 * instead of re-declaring it — the "do NOT duplicate names" rule from the
 * task brief. The entry's BODY is always fresh codex copy regardless. */
export type CodexContentRef = { kind: "heroClass"; id: HeroClass };

export interface CodexEntryDef {
  id: string;
  category: CodexCategoryId;
  /** i18n keys when set: `codex.entries.<id>.body` only (title/icon come
   * from `contentRef`). When omitted: both `codex.entries.<id>.title` and
   * `codex.entries.<id>.body` are required. */
  contentRef?: CodexContentRef;
}

export const CODEX_CATEGORIES: readonly CodexCategoryDef[] = [
  { id: "coreLoop" },
  { id: "character" },
  { id: "heroes" },
  { id: "boss" },
  { id: "controls" },
  { id: "offlineIdle" },
];

export const CODEX_ENTRIES: readonly CodexEntryDef[] = [
  { id: "coreLoop", category: "coreLoop" },

  // "character" (M5 Character Pivot): the single-hero systems that replaced
  // the old team + upgrade lines — creation slots, base stats, mana/skills +
  // auto slots, and the class-change quest.
  { id: "characterSlots", category: "character" },
  { id: "baseStats", category: "character" },
  { id: "manaSkills", category: "character" },
  { id: "classQuest", category: "character" },

  { id: "hero-swordsman", category: "heroes", contentRef: { kind: "heroClass", id: "swordsman" } },
  { id: "hero-archer", category: "heroes", contentRef: { kind: "heroClass", id: "archer" } },
  { id: "hero-mage", category: "heroes", contentRef: { kind: "heroClass", id: "mage" } },

  { id: "boss", category: "boss" },

  { id: "autoCast", category: "controls" },
  { id: "autoAllocate", category: "controls" },

  { id: "offlineIdle", category: "offlineIdle" },
];

/** Returns the `codex` namespace-relative i18n keys REQUIRED for an entry
 * (used both by the component and the headless coverage test — single
 * source of truth for "which keys must exist"). */
export function codexEntryRequiredKeys(entry: CodexEntryDef): string[] {
  const bodyKey = `entries.${entry.id}.body`;
  if (entry.contentRef) return [bodyKey];
  return [`entries.${entry.id}.title`, bodyKey];
}

export function codexEntriesByCategory(
  category: CodexCategoryId,
): readonly CodexEntryDef[] {
  return CODEX_ENTRIES.filter((e) => e.category === category);
}
