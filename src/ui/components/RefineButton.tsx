"use client";

/**
 * M7.6 ตีบวก — refine-station trigger for the settings row. Town NPCs phase 3
 * (final) turned `RefinePanel` into ลุงดึ๋ง's tap-again-to-talk dialog (see
 * `TownNpcPanelHost.tsx`), so this button is a SHORTCUT into that same flow
 * rather than an independent local open/close toggle.
 *
 * Owner UX round (2026-07-09, "ถ้ากดแล้วให้วิ่งมาหา npc... ถ้า disabled แบบนี้
 * user งง"): ALWAYS enabled, from anywhere — a press kicks off the "smith
 * trip" state machine (`gameStore.ts`'s `startSmithTrip`/`smithTrip`, driven
 * to completion by `SmithTripWatcher.tsx` off the throttled snapshot):
 *  - in town, already within ลุงดึ๋ง's talk radius: opens the dialog directly
 *    (`openTownPanel("lungdueng")`) — equivalent to having just talked to him.
 *  - in town, out of range: queues the same walk-to-NPC `moveTo` intent the
 *    tap-to-talk pointer flow uses, plus a one-line notice.
 *  - outside town: starts the existing fast-travel-to-town channel (same
 *    engine intent/rules as the warp menu — channel time, damage doesn't
 *    interrupt, death/boss-phase block via the existing `fastTravelBlocked`
 *    notice), then auto-continues the walk-to-NPC + auto-open once arrived.
 *
 * Styling (owner: "เปลี่ยนรูปให้เหมือนกับกระเป๋าไอเทม") matches
 * `InventoryButton.tsx`'s dock idiom exactly — same shape/border/size, emoji
 * baked into the label string (not a separate `<span>`).
 */

import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";

export function RefineButton() {
  const t = useTranslations("refine");
  const startSmithTrip = useGameStore((s) => s.startSmithTrip);

  return (
    <button
      type="button"
      onClick={startSmithTrip}
      className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
    >
      {t("openButton")}
    </button>
  );
}
