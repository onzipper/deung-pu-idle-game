"use client";

/**
 * Owner UX round (2026-07-09) — "ปุ่มตีบวก works from anywhere". Renders
 * nothing; drives the `smithTrip` state machine (`gameStore.ts` +
 * `ui/world/smithTrip.ts`'s pure transition function) off the throttled
 * snapshot — same "subscribe + side-effecting useEffect" idiom as
 * `TownNpcPanelHost.tsx`'s auto-close watch. Lives as its OWN component
 * (rather than folded into `RefineButton.tsx`) so the trip keeps advancing
 * (fast-travel arrival -> walk to smith -> auto-open his dialog) even while
 * the button itself scrolls out of view / a modal covers it.
 */

import { useEffect } from "react";
import { useGameStore } from "@/ui/store/gameStore";

export function SmithTripWatcher() {
  const smithTrip = useGameStore((s) => s.smithTrip);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const inRange = useGameStore((s) => s.npcInRange["npc:lungdueng"]);
  const dead = useGameStore((s) => s.heroes[0]?.dead ?? false);
  const advanceSmithTrip = useGameStore((s) => s.advanceSmithTrip);

  useEffect(() => {
    if (smithTrip === "idle") return;
    advanceSmithTrip();
  }, [smithTrip, inTown, inRange, dead, advanceSmithTrip]);

  return null;
}
