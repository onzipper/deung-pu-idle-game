"use client";

/**
 * Town NPCs phase 3 (final; extended M8 quest Wave C) — hosts the three NPC
 * dialog panels (`ShopPanel` for pahpu / `RefinePanel` for lungdueng /
 * `QuestBoardPanel` for elder) off the store's single `activeTownPanel` field
 * (see `gameStore.ts`'s `TownPanelId` doc). No panel auto-renders on town
 * arrival — a panel opens ONLY via the tap-to-talk pointer flow
 * (`GameClient.tsx`'s `talkToNpc`) or an in-flight `npcTrip`
 * (`gameStore.ts`'s `startNpcTrip`, e.g. `RefineButton.tsx`'s dock shortcut),
 * i.e. "tap-again-to-talk" (owner-approved).
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
import { QuestBoardPanel } from "@/ui/components/QuestBoardPanel";
import { RefinePanel } from "@/ui/components/RefinePanel";
import { ShopPanel } from "@/ui/components/ShopPanel";
import { useGameStore } from "@/ui/store/gameStore";
import type { TownNpcId } from "@/engine";
import type { TownPanelId } from "@/ui/store/gameStore";

const NPC_ID_BY_PANEL: Record<TownPanelId, TownNpcId> = {
  pahpu: "npc:pahpu",
  lungdueng: "npc:lungdueng",
  board: "npc:elder",
};

export function TownNpcPanelHost() {
  const activeTownPanel = useGameStore((s) => s.activeTownPanel);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const npcInRange = useGameStore((s) => s.npcInRange);
  const closeTownPanel = useGameStore((s) => s.closeTownPanel);

  useEffect(() => {
    if (!activeTownPanel) return;
    const id = NPC_ID_BY_PANEL[activeTownPanel];
    if (!inTown || !npcInRange[id]) closeTownPanel();
  }, [activeTownPanel, inTown, npcInRange, closeTownPanel]);

  if (activeTownPanel === "pahpu") return <ShopPanel onClose={closeTownPanel} />;
  if (activeTownPanel === "lungdueng") return <RefinePanel onClose={closeTownPanel} />;
  if (activeTownPanel === "board") return <QuestBoardPanel onClose={closeTownPanel} />;
  return null;
}
