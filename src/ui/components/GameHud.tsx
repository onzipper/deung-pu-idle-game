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
 * drains 1 fixed sub-step per real frame now. Scattered auto-* toggles
 * (autoAllocate/autoReturn/auto-potion thresholds/soundMuted/locale) now live
 * inside the `SettingsButton` drawer (M6 settings-panel task) rather than
 * scattered across this file's own rows — `autoCast`'s per-skill slotting
 * stays in `SkillBar.tsx` since it's genuinely part of the skill block, not a
 * generic setting.
 */

import { forwardRef, type ReactNode } from "react";
import { CodexButton } from "@/ui/components/CodexButton";
import { ConsumableBar } from "@/ui/components/ConsumableBar";
import { DropFeed } from "@/ui/components/DropFeed";
import { EquippedLoadout } from "@/ui/components/EquippedLoadout";
import { GoalLadder } from "@/ui/components/GoalLadder";
import { HudBar } from "@/ui/components/HudBar";
import { InventoryButton } from "@/ui/components/InventoryButton";
import { NoticeToast } from "@/ui/components/NoticeToast";
import { RefineButton } from "@/ui/components/RefineButton";
import { ShopPanel } from "@/ui/components/ShopPanel";
import { SettingsButton } from "@/ui/components/SettingsButton";
import { SkillBar } from "@/ui/components/SkillBar";
import { StatPanel } from "@/ui/components/StatPanel";
import { SwitchCharacterLink } from "@/ui/components/SwitchCharacterLink";
import { WalkControls } from "@/ui/components/WalkControls";
import { ContextualTipOverlay } from "@/ui/onboarding/ContextualTipOverlay";
import { OnboardingOverlay } from "@/ui/onboarding/OnboardingOverlay";

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
      {/* M7 Gear & Drops: drop-notification toasts, store-driven off claim
          results — sits above the arena, below the modal panels (z-70). */}
      <DropFeed />
      <NoticeToast />
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
      </div>

      {/* M6 "World & Town": zone/map label + walk arrows (functional; theming
          polish is a later task). */}
      <WalkControls />

      {/* NPC shop (M6): only rendered while standing in town. */}
      <ShopPanel />

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
            <CodexButton />
            <SettingsButton />
          </div>
        </div>
      </div>
    </div>
  );
});
