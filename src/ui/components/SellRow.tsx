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
 *
 * Owner request "ขาย item แบบเลือกหลายอัน" (multi-select sell): grew an
 * optional `selectMode` — when on, the WHOLE row becomes a toggle button
 * (checkmark corner + gold ring, >=44px tall) instead of the single-tap sell
 * button, and shows its vendor price. Outside select mode the row is
 * byte-identical to before. Only `ShopPanel.tsx`'s sell tab turns this on
 * today (`InventoryPanel.tsx` uses its own grid, not this row, so no gating
 * flag is needed there — smaller blast radius per the feature brief).
 */

import { useTranslations } from "next-intl";
import { ITEM_TEMPLATES } from "@/engine";
import { useConfirmGuard } from "@/ui/gear/useConfirmGuard";
import type { InventoryItem } from "@/ui/gear/types";
import { Button } from "@/ui/components/primitives/Button";
import { classTintClass, GEAR_SLOT_ICONS, prestigeNameClass, RARITY_COLORS, weaponGlyph } from "@/ui/labels";

export interface SellRowProps {
  item: InventoryItem;
  busy: boolean;
  onSell: (item: InventoryItem) => void;
  /** Multi-select mode (owner request, ShopPanel's sell tab only). */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: InventoryItem) => void;
  /** Vendor sell price, shown next to the name only while `selectMode` is on
   * (single-sell mode never showed a price before this feature — kept as-is
   * outside select mode to avoid an unrelated visual change). */
  price?: number;
}

export function SellRow({
  item,
  busy,
  onSell,
  selectMode = false,
  selected = false,
  onToggleSelect,
  price,
}: SellRowProps) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = ITEM_TEMPLATES[item.templateId];
  const sellGuard = useConfirmGuard();
  if (!template) return null;

  const colors = RARITY_COLORS[template.rarity];
  const needsConfirm = template.rarity === "rare" || template.rarity === "epic";
  const prestigeCls = prestigeNameClass(item.refineLevel);
  // Owner ask 2026-07-08: same per-class weapon glyph + tint as the bag grid
  // (sell rows never show equipped items — `ShopPanel.tsx` filters those out
  // before this component ever renders, so no equipped treatment needed here).
  const glyph = template.slot === "weapon" ? weaponGlyph(template.classReq) : GEAR_SLOT_ICONS.armor;
  const tint = classTintClass(template.classReq);

  const nameBlock = (
    <>
      <span aria-hidden className={`text-lg leading-none ${tint}`}>
        {glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight text-left">
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
    </>
  );

  if (selectMode) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect?.(item)}
        aria-pressed={selected}
        aria-label={tContent(`${item.templateId}.name`)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-(--ddp-radius-md) border-2 bg-black/25 px-2 py-1.5 text-left transition-colors active:scale-[0.99] ${
          selected ? "border-ddp-gold-bright bg-ddp-gold/10" : "border-ddp-border-soft"
        }`}
      >
        {nameBlock}
        <span className="flex shrink-0 items-center gap-1.5">
          {typeof price === "number" && (
            <span className="text-[11px] font-bold tabular-nums text-ddp-gold-bright">
              💰{price}
            </span>
          )}
          <span
            aria-hidden
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black ${
              selected
                ? "border-emerald-400 bg-emerald-400 text-emerald-950"
                : "border-ddp-border-soft bg-black/30 text-transparent"
            }`}
          >
            ✓
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 py-1.5">
      {nameBlock}
      <div className="flex shrink-0 gap-1.5">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => sellGuard.trigger(needsConfirm, () => onSell(item))}
          className="px-2.5 text-[11px]"
        >
          {sellGuard.confirming ? t("confirmSell") : t("sellButton")}
        </Button>
      </div>
    </div>
  );
}
