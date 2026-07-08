"use client";

/**
 * Equipment paper-doll — approved audit design. Pinned beside (desktop) or
 * above (mobile) the inventory bag, OUTSIDE the bag's `overflow-y-auto`
 * container so it never scrolls away (same tier as the capacity bar/tabs in
 * `InventoryPanel.tsx`).
 *
 * REAL slots (weapon/armor) mirror the live equipped instance — tapping one
 * routes back into the SAME `activeTab`/`selectedInstanceId` state the bag's
 * own grid tiles use, so `DetailCard` opens with the unequip action; no new
 * state shape, no new engine reads. Slot model math is pure and lives in
 * `ui/gear/dollModel.ts` (unit-tested there).
 *
 * TEASER slots (helmet/gloves/boots/amulet) are display-only "coming soon"
 * ghosts — no catalog entry exists for them, they never persist anything,
 * and tapping one only shows an ephemeral toast (owner-approved wording).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { lookupTemplate, type GearSlot } from "@/engine";
import { buildRealDollSlots, TEASER_SLOT_ICONS, type TeaserSlotKey } from "@/ui/gear/dollModel";
import type { InventoryItem } from "@/ui/gear/types";
import {
  classTintClass,
  GEAR_SLOT_ICONS,
  gearNameClass,
  RARITY_COLORS,
  RARITY_GLOW,
  TIER_BORDER_COLORS,
  weaponGlyph,
} from "@/ui/labels";

const TEASER_TOAST_MS = 1800;

function tierBorder(tier: number): string {
  return TIER_BORDER_COLORS[tier] ?? TIER_BORDER_COLORS[6];
}

function RealSlotButton({
  slot,
  item,
  active,
  onSelect,
}: {
  slot: GearSlot;
  item: InventoryItem | null;
  active: boolean;
  onSelect: (slot: GearSlot, instanceId: string | null) => void;
}) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = item ? lookupTemplate(item.templateId) : null;
  const tierCls = template ? tierBorder(template.tier) : "border-ddp-border-soft";
  const glow = template ? RARITY_GLOW[template.rarity] : "";
  // "ตำราตำนาน" legendary (endgame v1.3): gold-violet gradient name, else the
  // ordinary per-rarity text color.
  const nameCls =
    item && template
      ? gearNameClass(item.templateId, item.refineLevel) || RARITY_COLORS[template.rarity].text
      : "text-ddp-ink-muted/70";
  // Owner ask 2026-07-08: same per-class weapon glyph + subtle class tint as
  // the bag grid — every doll real-slot IS the equipped item already (no
  // separate "equipped" ribbon needed here, unlike the bag's owned pile).
  const glyph = template ? (slot === "weapon" ? weaponGlyph(template.classReq) : GEAR_SLOT_ICONS.armor) : GEAR_SLOT_ICONS[slot];
  const tint = template ? classTintClass(template.classReq) : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(slot, item?.instanceId ?? null)}
      aria-pressed={active}
      aria-label={item && template ? tContent(`${item.templateId}.name`) : t(`slot.${slot}`)}
      className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 bg-black/40 p-1 transition-transform duration-100 active:scale-95 ${tierCls} ${glow} ${active ? "ring-2 ring-ddp-gold-bright" : ""}`}
    >
      <span aria-hidden className={`text-xl leading-none ${tint}`}>
        {glyph}
      </span>
      {item && template ? (
        <span className={`w-full truncate text-center text-[8px] font-bold leading-tight ${nameCls}`}>
          {tContent(`${item.templateId}.name`)}
          {item.refineLevel > 0 && (
            <span className="text-emerald-400"> {t("refinePlus", { level: item.refineLevel })}</span>
          )}
        </span>
      ) : (
        <span className="text-[8px] font-bold text-ddp-ink-muted/50">{t("doll.emptyReal")}</span>
      )}
    </button>
  );
}

function TeaserSlotButton({
  slotKey,
  onTap,
}: {
  slotKey: TeaserSlotKey;
  onTap: (slotKey: TeaserSlotKey) => void;
}) {
  const t = useTranslations("inventory");
  return (
    <button
      type="button"
      onClick={() => onTap(slotKey)}
      aria-label={`${t(`doll.teaserName.${slotKey}`)} — ${t("doll.comingSoon")}`}
      className="relative flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-(--ddp-radius-md) border-2 border-dashed border-ddp-border-soft/70 bg-black/15 opacity-40 transition-opacity duration-100 active:scale-95 hover:opacity-60"
    >
      <span aria-hidden className="text-xl leading-none grayscale">
        {TEASER_SLOT_ICONS[slotKey]}
      </span>
      <span
        aria-hidden
        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 animate-pulse items-center justify-center rounded-full border border-ddp-border-soft bg-black/80 text-[9px] font-black text-ddp-ink-muted"
      >
        ?
      </span>
    </button>
  );
}

export interface EquipmentDollProps {
  inventory: readonly InventoryItem[];
  activeTab: GearSlot;
  onSelectReal: (slot: GearSlot, instanceId: string | null) => void;
  className?: string;
}

export function EquipmentDoll({ inventory, activeTab, onSelectReal, className }: EquipmentDollProps) {
  const t = useTranslations("inventory");
  const [toastKey, setToastKey] = useState<TeaserSlotKey | null>(null);
  const [weapon, armor] = buildRealDollSlots(inventory);

  useEffect(() => {
    if (!toastKey) return;
    const id = setTimeout(() => setToastKey(null), TEASER_TOAST_MS);
    return () => clearTimeout(id);
  }, [toastKey]);

  function handleTeaserTap(key: TeaserSlotKey): void {
    setToastKey(key);
  }

  return (
    <div className={`flex shrink-0 flex-col items-center gap-2 ${className ?? ""}`}>
      {/* Fixed-height toast row — reserves its space so appearing/disappearing
          never reflows the doll or the bag beside it. */}
      <div
        className="flex h-4 items-center justify-center text-center text-[10px] font-bold text-ddp-gold-bright transition-opacity duration-150"
        style={{ opacity: toastKey ? 1 : 0 }}
      >
        {t("doll.comingSoon")}
      </div>

      {/* Desktop layout: helmet top / gloves-weapon-amulet row / armor / boots. */}
      <div className="hidden flex-col items-center gap-2 md:flex">
        <TeaserSlotButton slotKey="helmet" onTap={handleTeaserTap} />
        <div className="flex items-center gap-2">
          <TeaserSlotButton slotKey="gloves" onTap={handleTeaserTap} />
          <RealSlotButton
            slot="weapon"
            item={weapon.item}
            active={activeTab === "weapon"}
            onSelect={onSelectReal}
          />
          <TeaserSlotButton slotKey="amulet" onTap={handleTeaserTap} />
        </div>
        <RealSlotButton slot="armor" item={armor.item} active={activeTab === "armor"} onSelect={onSelectReal} />
        <TeaserSlotButton slotKey="boots" onTap={handleTeaserTap} />
      </div>

      {/* Mobile layout: one flat horizontal strip, pinned above the tabs. */}
      <div className="flex items-center justify-center gap-1.5 md:hidden">
        <TeaserSlotButton slotKey="helmet" onTap={handleTeaserTap} />
        <TeaserSlotButton slotKey="gloves" onTap={handleTeaserTap} />
        <RealSlotButton
          slot="weapon"
          item={weapon.item}
          active={activeTab === "weapon"}
          onSelect={onSelectReal}
        />
        <RealSlotButton slot="armor" item={armor.item} active={activeTab === "armor"} onSelect={onSelectReal} />
        <TeaserSlotButton slotKey="amulet" onTap={handleTeaserTap} />
        <TeaserSlotButton slotKey="boots" onTap={handleTeaserTap} />
      </div>
    </div>
  );
}
