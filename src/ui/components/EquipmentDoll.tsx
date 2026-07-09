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
 *
 * R2-W3 reskin (mockup "EQUIPMENT" panel): filled real slots now render
 * through the shared `ItemTile` primitive (same tier/rarity/refine-badge
 * language as the bag grid's `GridCell` — no bespoke tile styling here
 * anymore) and a class-glyph "character" roundel (same visual grammar as
 * `SkillBar.tsx`'s portrait block, via the shared `HERO_ACCENT`/`HERO_ICONS`
 * — no new painted art) sits at the center, flanked left/right by the real
 * weapon/armor slots per the mockup's "gear flanks the character" layout.
 * Mobile keeps the flat single-row strip (now horizontally scrollable so a
 * narrow viewport can never overflow the modal) with the portrait pinned
 * above it.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { isLegendaryTemplate, lookupTemplate, type GearSlot, type HeroClass } from "@/engine";
import { buildRealDollSlots, TEASER_SLOT_ICONS, type TeaserSlotKey } from "@/ui/gear/dollModel";
import type { InventoryItem } from "@/ui/gear/types";
import { ItemTile } from "@/ui/components/primitives/ItemTile";
import {
  classTintClass,
  GEAR_SLOT_ICONS,
  HERO_ACCENT,
  HERO_ICONS,
  weaponGlyph,
} from "@/ui/labels";

const TEASER_TOAST_MS = 1800;

/** The center-of-doll class glyph roundel — same accent/level-badge grammar
 * as `SkillBar.tsx`'s hero portrait (shared `HERO_ACCENT`/`HERO_ICONS`), just
 * without the HP/MP bars (this panel isn't the combat HUD). */
function CharacterPortrait({ cls, level }: { cls: HeroClass; level: number }) {
  const tCommon = useTranslations("common");
  const accent = HERO_ACCENT[cls];
  return (
    <div
      aria-hidden
      className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 bg-black/50 shadow-(--ddp-shadow-btn)"
      style={{ borderColor: accent.solid, boxShadow: `0 0 10px 2px ${accent.soft}` }}
    >
      <span className="text-2xl leading-none">{HERO_ICONS[cls]}</span>
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-ddp-border-soft bg-black/90 px-1.5 py-0.5 text-[9px] leading-none font-black tabular-nums whitespace-nowrap text-ddp-ink">
        {tCommon("levelBadge", { level })}
      </span>
    </div>
  );
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
  // Owner ask 2026-07-08: same per-class weapon glyph + subtle class tint as
  // the bag grid — every doll real-slot IS the equipped item already (no
  // separate "equipped" ribbon needed here, unlike the bag's owned pile).
  const glyph = template ? (slot === "weapon" ? weaponGlyph(template.classReq) : GEAR_SLOT_ICONS.armor) : GEAR_SLOT_ICONS[slot];
  const tint = template ? classTintClass(template.classReq) : "";

  if (item && template) {
    return (
      <ItemTile
        rarity={template.rarity}
        tier={template.tier}
        equipped
        legendary={isLegendaryTemplate(item.templateId)}
        selected={active}
        onClick={() => onSelect(slot, item.instanceId)}
        ariaLabel={tContent(`${item.templateId}.name`)}
        glyph={glyph}
        glyphClassName={tint}
        subLabel={t("tierShort", { tier: template.tier })}
        refineBadge={item.refineLevel > 0 ? t("refinePlus", { level: item.refineLevel }) : undefined}
        className="h-16 w-16 shrink-0"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(slot, null)}
      aria-pressed={active}
      aria-label={t(`slot.${slot}`)}
      className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 border-ddp-border-soft bg-black/40 p-1 transition-transform duration-100 active:scale-95 ${active ? "ring-2 ring-ddp-gold-bright" : ""}`}
    >
      <span aria-hidden className="text-xl leading-none">
        {GEAR_SLOT_ICONS[slot]}
      </span>
      <span className="text-[8px] font-bold text-ddp-ink-muted/50">{t("doll.emptyReal")}</span>
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
  /** Character glyph roundel — display-only, no engine reads (caller already
   * has this off the throttled `HeroSummary` snapshot). */
  heroCls: HeroClass;
  heroLevel: number;
  className?: string;
}

export function EquipmentDoll({
  inventory,
  activeTab,
  onSelectReal,
  heroCls,
  heroLevel,
  className,
}: EquipmentDollProps) {
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

      {/* Desktop layout (mockup: character center, gear flanking left/right):
          helmet top-center / [weapon+gloves] flank-left | PORTRAIT | [armor+amulet]
          flank-right / boots bottom-center. */}
      <div className="hidden flex-col items-center gap-2 md:flex">
        <TeaserSlotButton slotKey="helmet" onTap={handleTeaserTap} />
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col gap-2">
            <RealSlotButton
              slot="weapon"
              item={weapon.item}
              active={activeTab === "weapon"}
              onSelect={onSelectReal}
            />
            <TeaserSlotButton slotKey="gloves" onTap={handleTeaserTap} />
          </div>
          <CharacterPortrait cls={heroCls} level={heroLevel} />
          <div className="flex flex-col gap-2">
            <RealSlotButton
              slot="armor"
              item={armor.item}
              active={activeTab === "armor"}
              onSelect={onSelectReal}
            />
            <TeaserSlotButton slotKey="amulet" onTap={handleTeaserTap} />
          </div>
        </div>
        <TeaserSlotButton slotKey="boots" onTap={handleTeaserTap} />
      </div>

      {/* Mobile layout: portrait above a flat horizontal strip. The strip is
          horizontally scrollable (`overflow-x-auto`) — 6 fixed 64px tiles
          don't fit inside a narrow phone's modal width, and clipping/wrapping
          would either cut tiles off or blow the panel's height; a scroll
          container keeps every tile tappable at its normal touch size
          without ever overflowing the modal shell. */}
      <div className="flex flex-col items-center gap-2 md:hidden">
        <CharacterPortrait cls={heroCls} level={heroLevel} />
        <div className="max-w-full overflow-x-auto">
          <div className="flex w-max items-center justify-center gap-1.5 px-0.5">
            <TeaserSlotButton slotKey="helmet" onTap={handleTeaserTap} />
            <TeaserSlotButton slotKey="gloves" onTap={handleTeaserTap} />
            <RealSlotButton
              slot="weapon"
              item={weapon.item}
              active={activeTab === "weapon"}
              onSelect={onSelectReal}
            />
            <RealSlotButton
              slot="armor"
              item={armor.item}
              active={activeTab === "armor"}
              onSelect={onSelectReal}
            />
            <TeaserSlotButton slotKey="amulet" onTap={handleTeaserTap} />
            <TeaserSlotButton slotKey="boots" onTap={handleTeaserTap} />
          </div>
        </div>
      </div>
    </div>
  );
}
