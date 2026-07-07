/**
 * "What's new" patch-notes registry (UAT task) — same shape/testability
 * contract as `onboarding/tips.ts`: pure TS (no React/DOM), so the release
 * list and the show/skip/record decision are headlessly testable
 * (`__tests__/patchNotes.test.ts`). `usePatchNotes.ts` is the only React glue.
 *
 * FUTURE RELEASES add an entry by APPENDING to `PATCH_NOTES` (+ matching
 * `messages/*.json` "patchNotes.releases.<id>.items.<key>" entries) — the
 * newest entry must always be LAST (`LATEST_PATCH_NOTES_ID` just reads the
 * tail), nothing else in this file's shape should need to change.
 */

export interface PatchNoteRelease {
  /** Also the i18n key segment under `patchNotes.releases.<id>` AND the
   * localStorage-recorded "last acknowledged" value (see
   * `readStoredSeenPatchNotes`/`writeSeenPatchNotes` in `store/gameStore.ts`). */
  id: string;
  /** Display-only (ISO date string); not currently used in any decision logic. */
  date: string;
  /** Full i18n keys (namespace "patchNotes"), one bullet line each — already
   * carry their own leading emoji per the exact copy this shipped with. */
  items: string[];
}

export const PATCH_NOTES: readonly PatchNoteRelease[] = [
  {
    id: "2026-07-07",
    date: "2026-07-07",
    items: [
      "releases.2026-07-07.items.refine",
      "releases.2026-07-07.items.manualPlay",
      "releases.2026-07-07.items.skills",
      "releases.2026-07-07.items.bot",
      "releases.2026-07-07.items.autoAllocate",
      "releases.2026-07-07.items.prestige",
      "releases.2026-07-07.items.announce",
      "releases.2026-07-07.items.intShare",
      "releases.2026-07-07.items.catchUp",
      "releases.2026-07-07.items.botFix",
      "releases.2026-07-07.items.kiteFix",
      "releases.2026-07-07.items.statTapFix",
      "releases.2026-07-07.items.botTrip",
    ],
  },
  {
    id: "2026-07-07b",
    date: "2026-07-07",
    items: [
      "releases.2026-07-07b.items.autoAdvance",
      "releases.2026-07-07b.items.classAura",
      "releases.2026-07-07b.items.gaugeFix",
      "releases.2026-07-07b.items.bossGateFix",
      "releases.2026-07-07b.items.copySweep",
    ],
  },
  // M7.9 Grand Expansion (world ×2 / class tier 3 / gear t7-10 / boss variety)
  // + the same-day mobile-modal and warp-picker fixes.
  {
    id: "2026-07-07c",
    date: "2026-07-07",
    items: [
      "releases.2026-07-07c.items.world",
      "releases.2026-07-07c.items.tier3",
      "releases.2026-07-07c.items.skill4",
      "releases.2026-07-07c.items.slot4",
      "releases.2026-07-07c.items.gear",
      "releases.2026-07-07c.items.boss",
      "releases.2026-07-07c.items.codex",
      "releases.2026-07-07c.items.warpFix",
      "releases.2026-07-07c.items.modalFix",
    ],
  },
  // M7.95 Hall of Fame + UAT round-2 polish (quest redesign, bot single-switch,
  // mob species, war-cry visibility, UX-fix wave).
  {
    id: "2026-07-08",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08.items.hof",
      "releases.2026-07-08.items.announce",
      "releases.2026-07-08.items.quest3",
      "releases.2026-07-08.items.questCard",
      "releases.2026-07-08.items.botSwitch",
      "releases.2026-07-08.items.botConfig",
      "releases.2026-07-08.items.species",
      "releases.2026-07-08.items.warcry",
      "releases.2026-07-08.items.skillInfo",
      "releases.2026-07-08.items.travel",
      "releases.2026-07-08.items.inventory",
      "releases.2026-07-08.items.refineSmooth",
      "releases.2026-07-08.items.facing",
      "releases.2026-07-08.items.epicBot",
    ],
  },
  // UAT round-3 (post-PR#12 playtest feedback): town NPCs, easy warp, quest
  // climb-first rule + routing fixes, quest-boss soft-lock fix, update banner.
  {
    id: "2026-07-08b",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08b.items.npc",
      "releases.2026-07-08b.items.warpEasy",
      "releases.2026-07-08b.items.questClimb",
      "releases.2026-07-08b.items.questLead",
      "releases.2026-07-08b.items.freeFarm",
      "releases.2026-07-08b.items.softLockFix",
      "releases.2026-07-08b.items.updateBanner",
    ],
  },
];

/** Ordered oldest -> newest by construction — the latest release is always
 * the last entry. */
export const LATEST_PATCH_NOTES_ID = PATCH_NOTES[PATCH_NOTES.length - 1].id;

export function latestPatchNotes(): PatchNoteRelease {
  return PATCH_NOTES[PATCH_NOTES.length - 1];
}

export type PatchNotesDecision = "show" | "recordOnly" | "none";

export interface PatchNotesDecisionInput {
  /** localStorage-persisted last-acknowledged release id (`ddp-seen-patch.v1`),
   * or `null` if never recorded (a genuinely first-ever load). */
  seenId: string | null;
  /** Parameterized (rather than reading `LATEST_PATCH_NOTES_ID` directly) so
   * this stays headlessly testable against arbitrary release ids. */
  latestId: string;
  /** True for a player who hasn't finished (or even started) the FTUE yet —
   * reuses the SAME "fresh save" heuristic the onboarding gate uses
   * (`isFreshSave` in `onboarding/steps.ts`), so a genuinely new character
   * never sees this modal stacked on top of / racing the FTUE overlay. The
   * id is still recorded (silently) so they don't get hit with a stale-
   * feeling recap the moment they finish onboarding. */
  isBrandNew: boolean;
}

/**
 * The framework's core decision function (mirrors `tips.ts`'s
 * `resolveTriggeredTip` / `steps.ts`'s `isFreshSave`-driven gate): pure and
 * DOM-free by construction — `usePatchNotes.ts` owns the localStorage/React
 * side, never re-implements this.
 *
 *  - "none": already acknowledged the latest release — nothing to do.
 *  - "recordOnly": a brand-new player — record the id silently, no modal
 *    (never stacks with the FTUE).
 *  - "show": show the modal; the caller records the id once the player taps
 *    the acknowledge button (not before — a tab closed mid-modal should see
 *    it again next load).
 */
export function resolvePatchNotesDecision(input: PatchNotesDecisionInput): PatchNotesDecision {
  if (input.seenId === input.latestId) return "none";
  if (input.isBrandNew) return "recordOnly";
  return "show";
}
