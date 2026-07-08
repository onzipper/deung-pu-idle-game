"use client";

/**
 * Layout composition: HUD bar, arena/canvas slot, skill bar, goal ladder,
 * console dock. The canvas itself is NOT owned here — Pixi mounting is the
 * render-integration seam's job. Callers either:
 *  - pass the canvas element (or a render-owning client component) as
 *    `children`, which is rendered inside the arena slot, or
 *  - forward a ref to grab the arena container `div` and mount imperatively
 *    (`app.canvas` appended in a `useEffect`) from outside `ui/`.
 *
 * HUD hierarchy (task 86d3jv7m3 readability pass, goal-ladder pass M6): PRIMARY
 * (top `HudBar` — zone/stage, gold) > SECONDARY (skill kit's level/XP/mana rows
 * + `GoalLadder` — the "what do I do next" element, which absorbed the old
 * `BossPanel`'s raw-stat row AND `HudBar`'s zone-unlock bar, see
 * `GoalLadder.tsx`) > TERTIARY (stat panel, settings drawer). The 1x/2x/3x
 * speed selector was removed player-facing (M6.7) — `GameClient`'s loop always
 * drains 1 fixed sub-step per real frame now. EVERY automation sub-behavior
 * (autoCast/autoAllocate/autoReturn/autoAdvance/auto-potion/bot town-trips/
 * auto-dispose rules) is consolidated behind the single `BotMasterSwitch` in
 * `WalkControls` (owner UX consolidation, 2026-07-07 — "one mental model per
 * feature") — `SettingsButton`'s drawer now holds only sound/language/generic
 * prefs. `autoCast`'s per-skill "+ อัตโนมัติ" slot badges stay in
 * `SkillBar.tsx` as a shortcut (mirrors the same store state).
 */

import { forwardRef, type ReactNode } from "react";
import { AnnouncementBanner } from "@/ui/components/AnnouncementBanner";
import { AsuraHotZoneBanner } from "@/ui/components/AsuraHotZoneBanner";
import { AsuraTomeButton } from "@/ui/components/AsuraTomeButton";
import { BuffBadgeHub } from "@/ui/components/BuffBadgeHub";
import { CodexButton } from "@/ui/components/CodexButton";
import { ConsumableBar } from "@/ui/components/ConsumableBar";
import { DropFeed, DropFeedCorner } from "@/ui/components/DropFeed";
import { EquippedLoadout } from "@/ui/components/EquippedLoadout";
import { FriendsButton } from "@/ui/components/FriendsButton";
import { GoalLadder } from "@/ui/components/GoalLadder";
import { HallOfFameButton } from "@/ui/components/HallOfFameButton";
import { HudBar } from "@/ui/components/HudBar";
import { InventoryButton } from "@/ui/components/InventoryButton";
import { NoticeToast } from "@/ui/components/NoticeToast";
import { RefineButton } from "@/ui/components/RefineButton";
import { SettingsButton } from "@/ui/components/SettingsButton";
import { SkillBar } from "@/ui/components/SkillBar";
import { StatPanel } from "@/ui/components/StatPanel";
import { SwitchCharacterLink } from "@/ui/components/SwitchCharacterLink";
import { TownNpcPanelHost } from "@/ui/components/TownNpcPanelHost";
import { UpdateBanner } from "@/ui/components/UpdateBanner";
import { WalkControls } from "@/ui/components/WalkControls";
import { WorldBossBanner } from "@/ui/components/WorldBossBanner";
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
  return (
    // Mobile-portrait-first shell: arena is the hero and always comes first;
    // the console dock (skills / potions / stats / settings) follows as one
    // coherent bottom panel rather than scattered floating boxes. Bottom
    // safe-area padding covers the phone home-indicator inset.
    <div className="flex w-full max-w-3xl flex-1 flex-col gap-3 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
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
          the modal panels (z-70) and the DropFeed/NoticeToast toasts (z-60)
          per the owner's "more prominent/special" directive. Never overlaps
          the goal card / console dock below (it lives in the page's top
          safe-area strip, not inside the HUD flow). */}
      <AnnouncementBanner />
      {/* Mid-session "new patch deployed" banner — same top strip as
          `AnnouncementBanner` above, mutually exclusive with it (see
          `UpdateBanner.tsx`'s doc: announcements play first). */}
      <UpdateBanner />
      {/* M7 Gear & Drops: EPIC-only drop-notification toast, store-driven off
          claim results — sits above the arena, below the modal panels
          (z-70). Commons/rares/stones moved into the arena's bottom-right
          corner (`DropFeedCorner` below) in Wave 3 "จัดระเบียบ DropFeed". */}
      <DropFeed />
      <NoticeToast />
      {/* World boss "เสี่ยจ๋อง": hourly countdown/found-it banner — renders nothing
          outside the pre-announce/active windows, see WorldBossBanner.tsx. */}
      <WorldBossBanner />
      {/* ดินแดนอสูร (endgame v1): today's hot zone — renders nothing outside
          asura, see AsuraHotZoneBanner.tsx. */}
      <AsuraHotZoneBanner />
      <HudBar />

      <div
        ref={canvasSlotRef}
        // Aspect matches the engine's logical arena (src/render/layout.ts
        // WORLD_WIDTH=900/WORLD_HEIGHT=300) so GameRenderer's letterboxing
        // has nothing to pad — the frame IS the world, no dead bars.
        className="relative aspect-900/300 w-full overflow-hidden rounded-(--ddp-radius-lg) border border-ddp-border bg-[#151a30] shadow-(--ddp-shadow-panel)"
      >
        {children}
        {/* Decorative inner frame (thin rim + soft vignette) drawn ON TOP of
            wherever GameRenderer imperatively appends its <canvas> — purely
            cosmetic, pointer-events-none so it never intercepts the arena's
            own pointerdown (audio-resume) listener. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-5 rounded-(--ddp-radius-lg) shadow-[inset_0_0_0_1px_rgba(143,151,201,0.18),inset_0_0_46px_12px_rgba(0,0,0,0.35)]"
        />
        {/* Buff Badge Hub (owner ask, "ห้ามดันจอ"): every active buff (party XP,
            war cry, future sources) as a floating icon overlay pinned to the
            arena's top-left corner — ZERO layout participation, never pushes
            the arena/console dock down. Renders nothing with no active
            buffs, see BuffBadgeHub.tsx. */}
        <BuffBadgeHub />
        {/* M8 party Wave 3 "ตัวบอกสถานะปาร์ตี้": network signal chip, mirrors
            BuffBadgeHub's top-[14%] placement on the OPPOSITE corner (right-2) —
            renders nothing solo, see PartySignalChip.tsx. */}
        <PartySignalChip />
        {/* Wave 3 "จัดระเบียบ DropFeed" (owner: "ไม่รก แต่รู้ว่าได้ของ"): common/rare
            item + stone pickup pills, coalesced max-3, bottom-right corner —
            mirrors BuffBadgeHub's top-left placement, ZERO layout
            participation. Epic keeps the top-center DropFeed beat above. */}
        <DropFeedCorner />
      </div>

      {/* M6 "World & Town": zone/map label + walk arrows (functional; theming
          polish is a later task). */}
      <WalkControls />

      {/* Town NPCs phase 3 (final): pahpu's shop / lungdueng's refine dialog —
          tap-again-to-talk gated (see `TownNpcPanelHost.tsx`), not an always-on
          panel anymore. */}
      <TownNpcPanelHost />

      <GoalLadder />

      <div className="flex flex-col gap-3.5 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-3 py-3.5 shadow-(--ddp-shadow-panel) backdrop-blur-sm sm:px-4">
        <SkillBar />
        {/* Quick-use potions stay near the hero's HP/mana rows above (owner ask:
            "potions near HP/mana") — the auto-use ON/OFF + thresholds are a
            tuning concern, not an in-the-moment action, so they moved into the
            settings drawer (M6 settings-panel task) instead of living here. */}
        <ConsumableBar />
        <div className="h-px bg-ddp-border-soft" />
        <StatPanel />
        {/* M7 Gear & Drops: equipped weapon/armor summary, right by the stat
            panel per the task brief. */}
        <EquippedLoadout />
        <div className="h-px bg-ddp-border-soft" />
        {/* Settings row (tertiary tier): account/help on the left, the settings
            drawer (auto-behavior + audio/language, M6 settings-panel task) on
            the right — no longer split around a speed selector (removed, M6.7). */}
        <div
          data-onboarding-anchor="settings-row"
          className="flex flex-wrap items-center justify-between gap-2.5"
        >
          <SwitchCharacterLink />
          <div className="flex flex-wrap items-center gap-2">
            <InventoryButton />
            <RefineButton />
            <HallOfFameButton />
            <FriendsButton />
            <CodexButton />
            {/* "ตำราตำนาน" — a NEW, standalone menu entry (endgame v1.2/v1.3 owner spec),
                invisible until `tomeUnlocked` (see AsuraTomeButton.tsx's own doc). */}
            <AsuraTomeButton />
            <SettingsButton />
          </div>
        </div>
      </div>
    </div>
  );
});
