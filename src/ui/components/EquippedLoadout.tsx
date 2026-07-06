"use client";

/**
 * M7 Gear & Drops — compact equipped weapon/armor summary, rendered near the
 * stat panel (task brief: "equipped loadout summary near the stat panel").
 * Reads the throttled `HeroSummary.equipped` (the sim's OWN applied loadout —
 * see that field's doc comment), never the DB-hydrated `inventory` slice, so
 * this always reflects what's actually affecting combat right now.
 */

import { useTranslations } from "next-intl";
import { refineOf, type GearSlot } from "@/engine";
import { GEAR_SLOT_ICONS, prestigeNameClass } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const SLOT_ORDER: readonly GearSlot[] = ["weapon", "armor"];

export function EquippedLoadout() {
  const equipped = useGameStore((s) => s.heroes[0]?.equipped);
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");

  if (!equipped) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-onboarding-anchor="equipped-loadout"
    >
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("loadoutLabel")}
      </span>
      {SLOT_ORDER.map((slot) => {
        const templateId = equipped[slot];
        const label = templateId ? tContent(`${templateId}.name`) : t("emptySlotHint");
        // M7.6 ตีบวก: the currently-applied refine +level (0 for an empty/
        // unrefined slot — no badge shown then).
        const refineLevel = templateId ? refineOf(equipped, slot) : 0;
        // M7.6+ polish: +8 and up gets prestige-gold name styling (ui/labels.ts).
        const prestigeCls = prestigeNameClass(refineLevel);
        return (
          <span
            key={slot}
            className="flex items-center gap-1 rounded-full border border-ddp-border-soft bg-black/40 px-2.5 py-1 text-xs font-bold text-ddp-ink"
          >
            <span aria-hidden>{GEAR_SLOT_ICONS[slot]}</span>
            <span className={prestigeCls}>{label}</span>
            {refineLevel > 0 && (
              <span className={prestigeCls || "text-emerald-400"}>
                {t("refinePlus", { level: refineLevel })}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
