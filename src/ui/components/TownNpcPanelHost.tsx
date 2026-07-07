"use client";

/**
 * Town NPCs phase 3 (final) — hosts the two NPC dialog panels (`ShopPanel` for
 * pahpu / `RefinePanel` for lungdueng) off the store's single `activeTownPanel`
 * field (see `gameStore.ts`'s `TownPanelId` doc). Neither panel auto-renders on
 * town arrival anymore — a panel opens ONLY via the tap-to-talk pointer flow
 * (`GameClient.tsx`'s `talkToNpc`) or the refine dock shortcut
 * (`RefineButton.tsx`), i.e. "tap-again-to-talk" (owner-approved).
 *
 * Auto-close-on-walk-away: watches the THROTTLED snapshot's `npcInRange` (and
 * `world.kind`) every render and clears `activeTownPanel` the instant the
 * hero leaves that NPC's talk range or leaves town outright — deliberately
 * CLEARS the field (not just conditionally hiding the render) so walking back
 * into range later does NOT silently reopen the dialog; the player must tap
 * again, matching the tap-again-to-talk model. The explicit ✕ button inside
 * each panel already calls the same `closeTownPanel` action, so this effect
 * is a no-op once a panel is closed that way.
 */

import { useEffect } from "react";
import { RefinePanel } from "@/ui/components/RefinePanel";
import { ShopPanel } from "@/ui/components/ShopPanel";
import { useGameStore } from "@/ui/store/gameStore";

export function TownNpcPanelHost() {
  const activeTownPanel = useGameStore((s) => s.activeTownPanel);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const npcInRange = useGameStore((s) => s.npcInRange);
  const closeTownPanel = useGameStore((s) => s.closeTownPanel);

  useEffect(() => {
    if (!activeTownPanel) return;
    const id = activeTownPanel === "pahpu" ? "npc:pahpu" : "npc:lungdueng";
    if (!inTown || !npcInRange[id]) closeTownPanel();
  }, [activeTownPanel, inTown, npcInRange, closeTownPanel]);

  if (activeTownPanel === "pahpu") return <ShopPanel onClose={closeTownPanel} />;
  if (activeTownPanel === "lungdueng") return <RefinePanel onClose={closeTownPanel} />;
  return null;
}
