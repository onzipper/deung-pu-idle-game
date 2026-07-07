"use client";

/**
 * M7.6 ตีบวก — refine-station trigger for the settings row. Town NPCs phase 3
 * (final) turned `RefinePanel` into ลุงดึ๋ง's tap-again-to-talk dialog (see
 * `TownNpcPanelHost.tsx`), so this button is now a SHORTCUT into that same
 * flow rather than an independent local open/close toggle:
 *
 *  - not in town: disabled, with the refine namespace's existing "town-only"
 *    hint as the tooltip (same copy `RefinePanel`'s own disabled reason uses).
 *  - in town, already within ลุงดึ๋ง's talk radius: opens the dialog directly
 *    (`openTownPanel("lungdueng")`) — equivalent to having just talked to him.
 *  - in town, out of range: queues the same walk-to-NPC `moveTo` intent the
 *    tap-to-talk pointer flow uses, plus a one-line notice telling the player
 *    to walk over first — no panel opens until they arrive and tap/retap.
 */

import { useTranslations } from "next-intl";
import { townNpcConfig } from "@/engine";
import { useGameStore } from "@/ui/store/gameStore";

export function RefineButton() {
  const t = useTranslations("refine");
  const inTown = useGameStore((s) => s.world.kind === "town");
  const inRange = useGameStore((s) => s.npcInRange["npc:lungdueng"]);
  const openTownPanel = useGameStore((s) => s.openTownPanel);
  const queueMoveTo = useGameStore((s) => s.queueMoveTo);
  const pushNotice = useGameStore((s) => s.pushNotice);

  function handleClick(): void {
    if (!inTown) return; // disabled below; defensive no-op
    if (inRange) {
      openTownPanel("lungdueng");
      return;
    }
    queueMoveTo(townNpcConfig("npc:lungdueng").x);
    pushNotice("walkToLungdueng");
  }

  return (
    <button
      type="button"
      disabled={!inTown}
      onClick={handleClick}
      title={!inTown ? t("disabled.townOnly") : undefined}
      className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden>⚒</span> {t("openButton")}
    </button>
  );
}
