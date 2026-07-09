"use client";

/**
 * R2.5-W3 menu-row NPC-trip tiles — supersedes the earlier "no HUD NPC
 * buttons" reading of `docs/ui-reference-map.md`'s LOCKED row. The owner made
 * a NEWER, more specific เคาะ this same planning round (recorded in that
 * doc's amended row): ร้านค้า/ตีบวก/ภารกิจ tiles ARE allowed on the HUD
 * PROVIDED they only ever trigger `startNpcTrip(npcId)` — a WALK-TO-NPC
 * command — never open a panel remotely. `npcTrip.ts`'s machine still routes
 * through the exact same tap-to-talk seam (`TownNpcPanelHost.tsx`) on
 * arrival, so "the world is a place, panels don't teleport open" survives
 * intact; these tiles are a faster way to ISSUE the walk order, not a
 * shortcut around it.
 *
 * ตีบวก absorbs `RefineButton.tsx`'s old dock-shortcut role — that file is
 * left in place (unused, already rewired onto `startNpcTrip`), its own doc
 * flags the delete-or-keep call for owner confirm.
 *
 * Guard: dims (a soft CSS state, NOT the native `disabled` attribute — a
 * fully inert button is what the owner complained about during the M7.6
 * smith-trip round, "ถ้า disabled แบบนี้ user งง", see `RefineButton.tsx`'s
 * doc) while `phase === "boss"` or a fast-travel channel/zone-transition is
 * already in flight — the SAME two conditions `startFastTravel` (engine)
 * rejects a trip's "traveling" leg over. Tapping while dimmed still fires,
 * but shows the reused `notices.fastTravelBlocked.{boss,traveling}` toast
 * instead of queuing the trip (the engine remains the real validator either
 * way — this is a same-round explanation, not a new source of truth). While
 * a trip is in flight FOR that specific npc, the tile pulses.
 */

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { QuestIcon, RefineIcon, ShopIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { useGameStore } from "@/ui/store/gameStore";
import type { Phase, TownNpcId } from "@/engine";

/** Mirrors `startFastTravel`'s "boss"/"traveling" reject reasons — the two
 * conditions worth explaining BEFORE the tap (dead/locked/invalid/same are
 * either unreachable from a menu tile or already surfaced elsewhere). */
function blockedReason(
  phase: Phase,
  worldTraveling: boolean,
  channeling: boolean,
): "boss" | "traveling" | null {
  if (phase === "boss") return "boss";
  if (worldTraveling || channeling) return "traveling";
  return null;
}

function NpcTripTile({
  npcId,
  icon,
  ariaLabel,
}: {
  npcId: TownNpcId;
  icon: ReactNode;
  ariaLabel: string;
}) {
  const phase = useGameStore((s) => s.phase);
  const worldTraveling = useGameStore((s) => s.world.traveling);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const inFlight = useGameStore((s) => s.npcTrip !== "idle" && s.npcTripTarget === npcId);
  const startNpcTrip = useGameStore((s) => s.startNpcTrip);
  const pushNotice = useGameStore((s) => s.pushNotice);

  const blocked = blockedReason(phase, worldTraveling, channeling);

  return (
    <IconTileButton
      icon={icon}
      aria-label={ariaLabel}
      title={ariaLabel}
      // `IconTileButton` deliberately omits `className` from its props (it
      // owns its own skin via `accent`) — dimming rides the plain `style`
      // prop instead of reaching around that. Kept subtle (opacity only, no
      // native `disabled`) so a tap while blocked still fires the guard
      // toast below rather than going silently dead.
      style={blocked ? { opacity: 0.45 } : undefined}
      badge={
        inFlight ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 h-2.5 w-2.5 animate-pulse rounded-full bg-ddp-gold-bright shadow-[0_0_4px_var(--color-amber-300)]"
          />
        ) : undefined
      }
      onClick={() => {
        if (blocked) {
          pushNotice(`fastTravelBlocked.${blocked}`);
          return;
        }
        startNpcTrip(npcId);
      }}
    />
  );
}

export function NpcTripButtons() {
  const tShop = useTranslations("shop");
  const tRefine = useTranslations("refine");
  const tQuest = useTranslations("questBoard");

  return (
    <>
      <NpcTripTile npcId="npc:pahpu" icon={<ShopIcon className="h-5 w-5" />} ariaLabel={tShop("menuAria")} />
      <NpcTripTile
        npcId="npc:lungdueng"
        icon={<RefineIcon className="h-5 w-5" />}
        ariaLabel={tRefine("menuAria")}
      />
      <NpcTripTile npcId="npc:elder" icon={<QuestIcon className="h-5 w-5" />} ariaLabel={tQuest("menuAria")} />
    </>
  );
}
