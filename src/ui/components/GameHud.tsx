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
    <div className="flex w-full max-w-3xl flex-col gap-2 p-3">
      <HudBar />
      <div
        ref={canvasSlotRef}
        className="relative aspect-[820/300] w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
      >
        {children}
      </div>
      <SkillBar />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <BossPanel />
        </div>
        <SpeedSelector />
        <SoundToggle />
      </div>
      <UpgradePanel />
    </div>
  );
});
