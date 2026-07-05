"use client";

/**
 * Layout composition: HUD bar, arena/canvas slot, skill bar, boss panel +
 * speed selector, upgrade panel. The canvas itself is NOT owned here — Pixi
 * mounting is the render-integration seam's job. Callers either:
 *  - pass the canvas element (or a render-owning client component) as
 *    `children`, which is rendered inside the arena slot, or
 *  - forward a ref to grab the arena container `div` and mount imperatively
 *    (`app.canvas` appended in a `useEffect`) from outside `ui/`.
 */

import { forwardRef, type ReactNode } from "react";
import { BossPanel } from "@/ui/components/BossPanel";
import { HudBar } from "@/ui/components/HudBar";
import { LocaleSwitch } from "@/ui/components/LocaleSwitch";
import { SkillBar } from "@/ui/components/SkillBar";
import { SoundToggle } from "@/ui/components/SoundToggle";
import { SpeedSelector } from "@/ui/components/SpeedSelector";
import { UpgradePanel } from "@/ui/components/UpgradePanel";

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
    // the console dock (skills / speed+sound / upgrades) follows as one
    // coherent bottom panel rather than scattered floating boxes. Bottom
    // safe-area padding covers the phone home-indicator inset.
    <div className="flex w-full max-w-3xl flex-1 flex-col gap-3 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
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

      <BossPanel />

      <div className="flex flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel px-3 py-3 shadow-(--ddp-shadow-panel) backdrop-blur-sm sm:px-4">
        <SkillBar />
        <div className="h-px bg-ddp-border-soft" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpeedSelector />
          <div className="flex items-center gap-3">
            <SoundToggle />
            <LocaleSwitch />
          </div>
        </div>
        <div className="h-px bg-ddp-border-soft" />
        <UpgradePanel />
      </div>
    </div>
  );
});
