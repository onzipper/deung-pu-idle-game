"use client";

/**
 * Owner UX round (2026-07-09) — "ปุ่มตีบวก works from anywhere", generalized
 * R2.5-W3 to any of the three town NPCs. Renders nothing; drives the
 * `npcTrip` state machine (`gameStore.ts` + `ui/world/npcTrip.ts`'s pure
 * transition function) off the throttled snapshot — same "subscribe +
 * side-effecting useEffect" idiom as `TownNpcPanelHost.tsx`'s auto-close
 * watch. Lives as its OWN component (rather than folded into any one
 * trigger) so the trip keeps advancing (fast-travel arrival -> walk to the
 * target npc -> auto-open their dialog) even while the trigger itself
 * scrolls out of view / a modal covers it. Was `SmithTripWatcher.tsx`
 * (lungdueng-only) before this generalization.
 */

import { useEffect } from "react";
import { useGameStore } from "@/ui/store/gameStore";

export function NpcTripWatcher() {
  const npcTrip = useGameStore((s) => s.npcTrip);
  const npcTripTarget = useGameStore((s) => s.npcTripTarget);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const inRange = useGameStore((s) => (npcTripTarget ? s.npcInRange[npcTripTarget] : false));
  const dead = useGameStore((s) => s.heroes[0]?.dead ?? false);
  const advanceNpcTrip = useGameStore((s) => s.advanceNpcTrip);

  useEffect(() => {
    if (npcTrip === "idle") return;
    advanceNpcTrip();
  }, [npcTrip, npcTripTarget, inTown, inRange, dead, advanceNpcTrip]);

  return null;
}
