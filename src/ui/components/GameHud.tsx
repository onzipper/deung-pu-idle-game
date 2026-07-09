"use client";

/**
 * R2-W2 "fullscreen HUD" (docs/ui-reference-map.md's "จอเกมใหญ่ + HUD ซ้อน" row,
 * mockup-driven): the game screen is now a FULLSCREEN canvas with every HUD
 * element as an absolute overlay on top of it — no more boxed `aspect-900/300`
 * arena + separate in-flow console dock below it. This is a full rewrite of
 * the old framed-arena layout (W5/M6-era `HudBar`/`WalkControls` scaffolding
 * is GONE — see the dissolution notes below); the canvas mount contract
 * `GameClient.tsx` depends on is preserved byte-for-byte (see next paragraph).
 *
 * Canvas mount seam (UNCHANGED — do not break): `GameClient.tsx` holds a ref
 * (`arenaRef`) forwarded here as `canvasSlotRef`; it calls
 * `waitForNonZeroSize(arenaEl)` then `renderer.create(arenaEl)` on that same
 * element, uses it as the `ResizeObserver` target, and reads
 * `arenaEl.getBoundingClientRect()` for pointer hit-testing. The div below
 * carrying `ref={canvasSlotRef}` IS that element — it must stay a plain,
 * unstyled-by-anything-that-affects-layout `absolute inset-0` box so
 * `GameRenderer`'s own any-aspect fill (W1) has a full-viewport target with
 * nothing else competing for space.
 *
 * Z-INDEX LADDER (documented once here — every new overlay picks a rung):
 *   z-0   canvas mount (Pixi appends its own `<canvas>` here)
 *   z-5   decorative screen-edge vignette (cosmetic, pointer-events-none) +
 *         a top-edge gradient scrim (same rung, also cosmetic/pointer-events-
 *         none) for contrast under the top-left portrait cluster and
 *         top-right currency/menu/minimap cluster on bright biomes
 *   z-10  the HUD overlay layer: top-left portrait+buffs, top-right
 *         currency+menu+party-signal, left-mid quest tracker, bottom-center
 *         skill dock, bottom-edge EXP/clock strip, DropFeedCorner (matches
 *         the arena-chip z-10 convention every sub-component already used)
 *   z-20  chip/button tooltips+popovers nested inside z-10 elements (owned by
 *         those components themselves, e.g. `BuffBadgeHub`/`PartySignalChip`)
 *   z-40  `ChatButton`'s floating trigger (owned by that component)
 *   z-60  `DropFeed` (epic-drop top-center toast) — unchanged
 *   z-70  every modal panel via `ModalPortal` (unchanged, portals to
 *         `document.body` so this ladder doesn't even apply structurally)
 *   z-74  `UpdateBanner` / z-75 `AnnouncementBanner` — unchanged, both
 *         deliberately paint OVER the top-left portrait during their ~5s
 *         slide animation (owner-approved "more prominent" requirement)
 *
 * Dissolved components (owner UX consolidation, this wave):
 *  - `HudBar.tsx` — zone-chip's world-map trigger became `WorldMapButton.tsx`,
 *    the 🌀 warp trigger became `WarpButton.tsx`, the gold/material chips
 *    became `CurrencyChipsRow.tsx`. File deleted (nothing left in it).
 *  - `WalkControls.tsx` — the zone/map text label is dropped (W3's minimap
 *    card is the next place a live zone readout belongs); `CancelCommandChip`
 *    and `FastTravelChannelBar` relocated to float above the skill dock.
 *    File deleted (nothing left in it).
 *  - The old inline "settings row" (`StatPanel`/`EquippedLoadout`/
 *    `SwitchCharacterLink`) moved into the NEW `CharacterPanel.tsx` behind
 *    `CharacterButton.tsx` in the icon menu row — nothing became unreachable.
 *  - `RefineButton.tsx` is NOT in the new icon menu row — `NpcTripButtons.tsx`
 *    (below) absorbs its dock-shortcut role (ตีบวก tile → `startNpcTrip
 *    ("npc:lungdueng")`). `RefineButton.tsx`'s file is left in place (unused,
 *    already rewired onto `startNpcTrip`) — a judgment call flagged for owner
 *    confirm, not an explicit deletion instruction.
 *
 * R2.5-W3, ร้านค้า/ตีบวก/ภารกิจ HUD tiles: `docs/ui-reference-map.md`'s
 * ORIGINAL locked row ("ปุ่มร้านค้า/ภารกิจบน HUD ไม่เอา") read as a blanket ban
 * on any NPC-triggering HUD button. The owner issued a NEWER, more specific
 * เคาะ this same R2.5 planning round (that doc's row is amended, not
 * re-litigated here): these tiles ARE allowed PROVIDED they only ever issue
 * `startNpcTrip(npcId)` — a walk-to-npc command routed through the exact same
 * tap-to-talk seam (`TownNpcPanelHost.tsx`) a manual walk-up uses — never a
 * remote panel open. See `NpcTripButtons.tsx`'s doc for the full guard/pulse
 * behavior.
 *
 * W3 minimap slot: the top-right column's `data-hud-slot="w3-npc-minimap"`
 * marker now wraps `MiniMapCard` — a compact zone-summary that taps through
 * to the existing `WorldMapPanel`, not a second minimap system.
 */

import { forwardRef, useRef, type ReactNode } from "react";
import { AnnouncementBanner } from "@/ui/components/AnnouncementBanner";
import { AsuraHotZoneBanner } from "@/ui/components/AsuraHotZoneBanner";
import { AsuraTomeButton } from "@/ui/components/AsuraTomeButton";
import { BuffBadgeHub } from "@/ui/components/BuffBadgeHub";
import { CancelCommandChip } from "@/ui/components/CancelCommandChip";
import { CharacterButton } from "@/ui/components/CharacterButton";
import { CodexButton } from "@/ui/components/CodexButton";
import { CurrencyChipsRow } from "@/ui/components/CurrencyChipsRow";
import { DropFeed, DropFeedCorner } from "@/ui/components/DropFeed";
import { ExpClockStrip } from "@/ui/components/ExpClockStrip";
import { FastTravelChannelBar } from "@/ui/components/FastTravelChannelBar";
import { FriendsButton } from "@/ui/components/FriendsButton";
import { GateTripWatcher } from "@/ui/components/GateTripWatcher";
import { GoalLadderOverlaySlot } from "@/ui/components/GoalLadderOverlaySlot";
import { HallOfFameButton } from "@/ui/components/HallOfFameButton";
import { HeroPortraitCard } from "@/ui/components/HeroPortraitCard";
import { InventoryButton } from "@/ui/components/InventoryButton";
import { MiniMapCard } from "@/ui/components/MiniMapCard";
import { NoticeToast } from "@/ui/components/NoticeToast";
import { NpcTripButtons } from "@/ui/components/NpcTripButtons";
import { NpcTripWatcher } from "@/ui/components/NpcTripWatcher";
import { SettingsButton } from "@/ui/components/SettingsButton";
import { SkillDock } from "@/ui/components/SkillDock";
import { TownNpcPanelHost } from "@/ui/components/TownNpcPanelHost";
import { UpdateBanner } from "@/ui/components/UpdateBanner";
import { WarpButton } from "@/ui/components/WarpButton";
import { WorldBossBanner } from "@/ui/components/WorldBossBanner";
import { WorldMapButton } from "@/ui/components/WorldMapButton";
import { ContextualTipOverlay } from "@/ui/onboarding/ContextualTipOverlay";
import { OnboardingOverlay } from "@/ui/onboarding/OnboardingOverlay";
import { PartySignalChip } from "@/ui/party/PartySignalChip";
import { ChatButton } from "@/ui/chat/ChatButton";

export interface GameHudProps {
  /** Canvas content (e.g. a Pixi-mounting client component) for the arena slot. */
  children?: ReactNode;
}

export const GameHud = forwardRef<HTMLDivElement, GameHudProps>(function GameHud(
  { children },
  canvasSlotRef,
) {
  // Portal target for `GoalLadderOverlaySlot` — the slot div below, rendered
  // INSIDE the same fullscreen stack so the quest tracker overlays the arena
  // on every viewport now (see that component's doc for why it's a portal).
  const questOverlayRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0e1a]">
      {/* Fullscreen Pixi mount — see the module doc's "canvas mount seam"
          paragraph. Nothing else may affect this element's box model.
          `children` (unused by the real call site today — `GameClient.tsx`
          appends its canvas imperatively — but kept for the documented
          prop contract) renders inside it, same as before this rewrite. */}
      <div ref={canvasSlotRef} className="absolute inset-0 z-0">
        {children}
      </div>

      {/* Decorative screen-edge vignette — cosmetic only, pointer-events-none
          so it never intercepts the canvas's own pointerdown (audio-resume)
          listener or hit-testing. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-5 shadow-[inset_0_0_60px_16px_rgba(0,0,0,0.45)]"
      />

      {/* Top-edge gradient scrim — extra contrast for the top-left portrait
          cluster and top-right currency/menu/minimap cluster on bright
          biomes, without boxing either cluster or darkening mid-screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-5 h-28 bg-gradient-to-b from-black/35 to-transparent"
      />

      {/* FTUE overlay (M4.8): fixed/viewport-anchored, reads its own store
          slice + `data-onboarding-anchor` DOM targets below — see
          src/ui/onboarding/. Renders null once onboarding isn't active.
          ContextualTipOverlay (M4.8 card A/B) is its progressive-disclosure
          sibling — gated so the two are never active at the same time. */}
      <OnboardingOverlay />
      <ContextualTipOverlay />
      {/* M8 party Wave 3 "global chat": fixed/viewport-anchored floating trigger +
          unread badge (mobile bottom-left, desktop right-edge mid-height) — the
          slide-in panel it opens portals through ModalPortal, see ChatButton.tsx. */}
      <ChatButton />
      {/* M7.9: server-wide high-refine announcements — a full-width slide-down
          strip at the very top of the viewport (z-75), deliberately ABOVE
          every other overlay rung (see the z-ladder doc above). */}
      <AnnouncementBanner />
      {/* Mid-session "new patch deployed" banner — same top strip as
          `AnnouncementBanner` above, mutually exclusive with it (see
          `UpdateBanner.tsx`'s doc: announcements play first). */}
      <UpdateBanner />
      {/* M7 Gear & Drops: EPIC-only drop-notification toast, top-center,
          above the HUD overlay layer (z-60) — see DropFeed.tsx's doc. */}
      <DropFeed />

      {/* ---- THE HUD OVERLAY LAYER (z-10) — one fullscreen pointer-events-none
          grid; every region below restores pointer-events-auto for its own
          content so taps pass through to the canvas everywhere else. ---- */}
      <div
        className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between gap-2 p-2 sm:p-3"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
          paddingRight: "max(0.5rem, env(safe-area-inset-right))",
        }}
      >
        {/* TOP: portrait+buffs (left) / currency+menu+party-signal (right),
            plus the in-flow world-boss/hot-zone banner strip beneath both. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            {/* Top-left: hero portrait card + active-buff chips stacked
                directly below it (both used to hand-tune a `top-[14%]`
                offset to avoid colliding — now they're just flow siblings). */}
            <div className="pointer-events-auto flex flex-col items-start gap-1.5">
              <HeroPortraitCard />
              <BuffBadgeHub />
            </div>
            {/* Top-right: gold/material chips, the icon menu row (R2.5-W3
                adds the 3 `NpcTripButtons` tiles into it), then the party
                signal chip — W3's minimap card appends after that, see the
                module doc. */}
            <div className="pointer-events-auto flex flex-col items-end gap-1.5">
              <CurrencyChipsRow />
              {/* Issue #58 wave B: `grid-cols-5` (was 4) + `IconTileButton`'s
                  40px mobile floor packs the 10 tiles into 2 rows instead of
                  3 below `sm:` — the #54 audit's biggest single vertical-space
                  win in this cluster. `sm:` and up is UNCHANGED (still
                  `flex`/`justify-end`, still 44px tiles) — desktop must not
                  regress. */}
              <div
                data-onboarding-anchor="menu-row"
                className="grid grid-cols-5 gap-1 sm:flex sm:flex-wrap sm:gap-1.5 sm:justify-end"
              >
                <CharacterButton />
                <InventoryButton />
                {/* R2.5-W3: ร้านค้า/ตีบวก/ภารกิจ — each a `startNpcTrip(npcId)`
                    walk-order, never a remote panel open. See the module
                    doc's amended-ruling paragraph + NpcTripButtons.tsx. */}
                <NpcTripButtons />
                <HallOfFameButton />
                <FriendsButton />
                <CodexButton />
                <AsuraTomeButton />
                <WorldMapButton />
                <WarpButton />
                <SettingsButton />
              </div>
              <PartySignalChip />
              {/* W3: compact minimap/zone-summary card, tap → WorldMapPanel.
                  See MiniMapCard.tsx's doc — this is NOT the R4/R5 corner
                  minimap proper (that waits on true x,y world geometry per
                  docs/ui-reference-map.md), just a compact reader on the
                  existing R1 WorldMapPanel surface. */}
              <div data-hud-slot="w3-npc-minimap">
                <MiniMapCard />
              </div>
            </div>
          </div>
          {/* World boss / ดินแดนอสูร hot-zone: plain in-flow strips (unchanged
              components — see their own docs), centered below the top row so
              they never collide with either corner. */}
          <div className="pointer-events-auto mx-auto flex w-full max-w-md flex-col gap-1">
            <WorldBossBanner />
            <AsuraHotZoneBanner />
          </div>
        </div>

        {/* MID: quest/goal tracker, left-anchored, filling the remaining
            vertical space between the top row and the bottom dock (no
            hand-tuned `top-N%` — the flex-1 region's own box IS the
            available space, so it structurally can't collide with either
            neighbor). */}
        <div className="relative min-h-0 flex-1 pt-1">
          {/* Issue #58 wave B: verified this can't structurally overlap the
              top-left portrait+buffs cluster — this `flex-1` region is a
              normal flex SIBLING that starts right after the top block (not
              viewport-anchored), so the tracker's `top-0` is always flush
              below it. The `pt-1` above is a small extra breathing-room
              margin (absolute children measure from the padding edge, so
              `max-h-full` shrinks to match); `max-w-[72vw]` (was 78vw) keeps
              the card's mobile width in the same ballpark as the portrait
              card's own `max-w-[70vw]` cap for visual rhythm. */}
          <div
            ref={questOverlayRef}
            className="pointer-events-none absolute top-0 left-0 z-10 max-h-full w-64 max-w-[72vw] overflow-y-auto sm:w-72"
          />
        </div>

        {/* BOTTOM: gate/smith-trip cancel chip + fast-travel channel bar +
            notices float just above the skill dock; the dock itself (skills
            + AUTO + potions, collapsible to a thin strip — R2.6 Wave 2, see
            `SkillDock.tsx`); the full-width EXP/clock strip pins the true
            bottom edge and stays ALWAYS visible regardless of dock state. */}
        <div className="pointer-events-auto flex w-full flex-col items-center gap-2">
          <div className="flex flex-col items-center gap-1.5 px-2">
            <NoticeToast />
            <CancelCommandChip />
            <FastTravelChannelBar />
          </div>
          <SkillDock />
          <ExpClockStrip />
        </div>
      </div>

      {/* Drops corner (commons/rares/stones) — its own fixed offset clearing
          the bottom dock, see DropFeed.tsx's doc. */}
      <DropFeedCorner />

      <GoalLadderOverlaySlot overlayRef={questOverlayRef} />

      {/* Town NPCs phase 3 (final): pahpu's shop / lungdueng's refine dialog —
          tap-again-to-talk gated (see `TownNpcPanelHost.tsx`), not an always-on
          panel. Each portals its own `ModalPortal` (z-70). */}
      <TownNpcPanelHost />
      {/* Owner UX round (2026-07-09), generalized R2.5-W3 to any town NPC:
          drives the ปุ่มตีบวก-style "npc trip" state machine to completion —
          renders nothing, see NpcTripWatcher.tsx. */}
      <NpcTripWatcher />
      {/* Owner UX round (2026-07-09): drives the "walk to the gate first"
          state machine to completion — renders nothing, see
          GateTripWatcher.tsx. */}
      <GateTripWatcher />
    </div>
  );
});
