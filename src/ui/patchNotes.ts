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
  // Town manual-play hotfix (owner UAT report): tap-to-move + NPC approach were
  // dead in town — the step() town early-return dropped every move command.
  {
    id: "2026-07-08c",
    date: "2026-07-08",
    items: ["releases.2026-07-08c.items.townWalkFix", "releases.2026-07-08c.items.shopSell"],
  },
  // UAT "ซื้อคืน" (buy-back): re-purchase an accidentally-sold item within 3
  // days at its sold price — third tab on Pah Pu's shop dialog.
  {
    id: "2026-07-08d",
    date: "2026-07-08",
    items: ["releases.2026-07-08d.items.buyback"],
  },
  // M8 close-out: accounts + friends + party phase 1 + quest overhaul +
  // friend-warp scroll + materials-from-drop + mana-burn pass + town llama.
  {
    id: "2026-07-08e",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08e.items.account",
      "releases.2026-07-08e.items.friends",
      "releases.2026-07-08e.items.party",
      "releases.2026-07-08e.items.quest",
      "releases.2026-07-08e.items.warpFriend",
      "releases.2026-07-08e.items.materials",
      "releases.2026-07-08e.items.manaCut",
      "releases.2026-07-08e.items.llama",
    ],
  },
  // M8 party goes LIVE: real-time same-zone co-op (lockstep over the Render
  // relay) + the connection-fix wave from the owner's first live party test.
  {
    id: "2026-07-08f",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08f.items.partyLive",
      "releases.2026-07-08f.items.partyBuff",
      "releases.2026-07-08f.items.partyChip",
      "releases.2026-07-08f.items.connFix",
    ],
  },
  // Live-test round 2: the cohort freeze fix (turn-0 pre-seed) + smooth per-frame
  // stepping + real names + pov-gated skill spectacle + party cap 3 -> 6.
  {
    id: "2026-07-08g",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08g.items.freezeFix",
      "releases.2026-07-08g.items.smooth",
      "releases.2026-07-08g.items.names",
      "releases.2026-07-08g.items.povFx",
      "releases.2026-07-08g.items.party6",
      "releases.2026-07-08g.items.social",
    ],
  },
  // Live-test round 3: cohort no longer stalls on a hidden tab (shadow lane
  // auto-fill + proactive leave/rejoin), warp leaves the cohort solo, town
  // walking works for every member.
  {
    id: "2026-07-08h",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08h.items.stallFix",
      "releases.2026-07-08h.items.warpSolo",
      "releases.2026-07-08h.items.townWalk",
    ],
  },
  // Live-test round 4: per-member wallets in a party (gold/potions/stones no longer
  // shared-pot corrupted), rotating drop assignment (no N× duplication), mid-party
  // bot toggles, reconnect re-handshake (no more stuck "connecting"), multi-select sell.
  {
    id: "2026-07-08i",
    date: "2026-07-08",
    items: [
      "releases.2026-07-08i.items.wallet",
      "releases.2026-07-08i.items.drops",
      "releases.2026-07-08i.items.botToggle",
      "releases.2026-07-08i.items.reconnect",
      "releases.2026-07-08i.items.multiSell",
    ],
  },
  // World boss "เสี่ยจ๋อง" (hourly, party-gated) + "แกร่ง" fortifier (guaranteed-
  // success refine) + the warp-after-boss-victory softlock fix + the ninja
  // wave (4th special class + 4th character slot, docs/ninja-design.md).
  {
    id: "2026-07-09",
    date: "2026-07-09",
    items: [
      "releases.2026-07-09.items.worldBoss",
      "releases.2026-07-09.items.fortifier",
      "releases.2026-07-09.items.warpVictoryFix",
      "releases.2026-07-09.items.ninja",
    ],
  },
  // HOF seasonal rewards (owner-approved docs/hof-rewards-design.md): monthly
  // titles + gold champion aura + town honor board + rank-1 fortifier claim +
  // permanent collectible badges. PLUS the owner's "every change this round gets
  // announced" sweep: flat shop pricing + the world-boss zone-lifecycle hotfix +
  // the ninja dagger drop-claim hotfix (PR #27 shipped without notes — recorded
  // here so players see them).
  {
    id: "2026-07-09b",
    date: "2026-07-09",
    items: [
      "releases.2026-07-09b.items.titles",
      "releases.2026-07-09b.items.aura",
      "releases.2026-07-09b.items.honorBoard",
      "releases.2026-07-09b.items.rank1Reward",
      "releases.2026-07-09b.items.badges",
      "releases.2026-07-09b.items.flatPrices",
      "releases.2026-07-09b.items.worldBossFix",
      "releases.2026-07-09b.items.daggerFix",
    ],
  },
  {
    id: "2026-07-09c",
    date: "2026-07-09",
    items: ["releases.2026-07-09c.items.hofRedesign"],
  },
  // Podium stage redesign (owner: rank-1 row "ไม่ค่อยพิเศษเลย") + the same-day
  // ninja engine wave (attack cadence + bot dash-evade — see engine zone).
  {
    id: "2026-07-09d",
    date: "2026-07-09",
    items: [
      "releases.2026-07-09d.items.podium",
      "releases.2026-07-09d.items.ninjaCadence",
      "releases.2026-07-09d.items.ninjaDash",
    ],
  },
  // Buff Badge Hub (owner ask: one HUD spot for every active buff) + party
  // quick-start (accept/invite/leave already refetch immediately — this wave
  // makes that explicit + gates the open-panel refresh on staleness) + the
  // same-day engine "party feel pack": target-spread auto-hunt, quest-boss
  // headcount HP scaling, and the party XP buff raised to +10%/member.
  {
    id: "2026-07-09e",
    date: "2026-07-09",
    items: [
      "releases.2026-07-09e.items.buffHub",
      "releases.2026-07-09e.items.partyFast",
      "releases.2026-07-09e.items.partySpread",
      "releases.2026-07-09e.items.questBossScale",
      "releases.2026-07-09e.items.partyBuff10",
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
