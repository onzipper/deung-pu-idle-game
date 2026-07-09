"use client";

/**
 * Owner UX round (2026-07-09) — "เดินไปที่ประตูก่อน แล้วค่อยวาป". Renders
 * nothing; drives the `gateTrip` state machine (`gameStore.ts` +
 * `ui/world/gateTrip.ts`'s pure transition function) off the throttled
 * snapshot — same "subscribe + side-effecting useEffect" idiom as
 * `SmithTripWatcher.tsx`. Lives as its OWN component (rather than folded into
 * the gate-tap handler) so the trip keeps advancing (walk to the gate ->
 * transition on arrival) even across whatever else is rendering that tick.
 */

import { useEffect } from "react";
import { useGameStore } from "@/ui/store/gameStore";

export function GateTripWatcher() {
  const gateTrip = useGameStore((s) => s.gateTrip);
  const heroX = useGameStore((s) => s.heroes[0]?.x ?? 0);
  const dead = useGameStore((s) => s.heroes[0]?.dead ?? false);
  const mapId = useGameStore((s) => s.world.mapId);
  const zoneIdx = useGameStore((s) => s.world.zoneIdx);
  const advanceGateTrip = useGameStore((s) => s.advanceGateTrip);

  useEffect(() => {
    if (gateTrip === "idle") return;
    advanceGateTrip();
  }, [gateTrip, heroX, dead, mapId, zoneIdx, advanceGateTrip]);

  return null;
}
