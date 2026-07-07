"use client";

/**
 * One sellable inventory row (ShopPanel's ป้าปุ๊ sell tab) — same
 * tap-again-to-confirm guard on rare/epic as `InventoryPanel.tsx`'s
 * `DetailCard` (via the shared `useConfirmGuard` hook), same button styling.
 * List-row layout rather than the inventory grid's card, since the shop tab
 * has no equip/select affordance — it's a flat scan-and-sell list.
 *
 * Owner request 2026-07-08 (หินเสริมพลัง final wave): salvage is RETIRED (was
 * `SellSalvageRow` — refine stones now drop directly from mobs instead), so
 * this row is sell-only.
 */

import { useTranslations } from "next-intl";
import { ITEM_TEMPLATES } from "@/engine";
import { useConfirmGuard } from "@/ui/gear/useConfirmGuard";
import type { InventoryItem } from "@/ui/gear/types";
import { GEAR_SLOT_ICONS, prestigeNameClass, RARITY_COLORS } from "@/ui/labels";

export interface SellRowProps {
  item: InventoryItem;
  busy: boolean;
  onSell: (item: InventoryItem) => void;
}

export function SellRow({ item, busy, onSell }: SellRowProps) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = ITEM_TEMPLATES[item.templateId];
  const sellGuard = useConfirmGuard();
  if (!template) return null;

  const colors = RARITY_COLORS[template.rarity];
  const needsConfirm = template.rarity === "rare" || template.rarity === "epic";
  const prestigeCls = prestigeNameClass(item.refineLevel);

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 py-1.5">
      <span aria-hidden className="text-lg leading-none">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={`truncate text-xs ${prestigeCls || `font-bold ${colors.text}`}`}>
          {colors.icon} {tContent(`${item.templateId}.name`)}
          {item.refineLevel > 0 && (
            <span className={prestigeCls || "text-emerald-400"}>
              {" "}
              {t("refinePlus", { level: item.refineLevel })}
            </span>
          )}
        </span>
        <span className="truncate text-[10px] text-ddp-ink-muted">
          {t("tierLabel", { tier: template.tier })} · {t(`rarity.${template.rarity}`)}
        </span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => sellGuard.trigger(needsConfirm, () => onSell(item))}
          className="min-h-11 rounded-(--ddp-radius-md) border border-amber-400/60 bg-amber-400/10 px-2.5 text-[11px] font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sellGuard.confirming ? t("confirmSell") : t("sellButton")}
        </button>
      </div>
    </div>
  );
}
