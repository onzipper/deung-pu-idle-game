"use client";

/**
 * M7.5→M7.9 Inventory UX — a RO-style GRID, one tile PER OWNED INSTANCE
 * (M7.9 "owner: no stacking" — the old `templateId:refineLevel` ×N grouping,
 * `ui/gear/stacking.ts`'s `groupIntoStacks`, is used ONLY by other consumers
 * now — `RefinePanel.tsx` and the bot's auto-dispose sweep, `ui/gear/autoSell.ts`
 * — this display layer reads `inventory` directly). Default sort is
 * BEST → WORST: tier desc, then refine +level desc, then rarity (epic > rare
 * > common) desc, then flat primary-stat total desc (`ui/gear/sortRank.ts`'s
 * `compareInventoryItems` — extracted so `ShopPanel.tsx`'s sell tab shares the
 * exact same ranking).
 * Every tile action (equip/sell) now targets exactly ONE instance id — no more
 * "sell all of this stack" bulk action at the tile level (the inventory-wide
 * "sell all common" bulk button above the grid is unchanged, it already scans
 * `inventory` directly — also in `sortRank.ts`, shared with `ShopPanel.tsx`).
 * Same modal shell convention as `SettingsPanel.tsx`/`CodexPanel.tsx` (fixed
 * overlay, sim never pauses behind it).
 *
 * Owner request 2026-07-08 (หินเสริมพลัง final wave): salvage is RETIRED
 * (refine stones now drop directly from mobs instead of a salvage grind) —
 * the per-item/bulk salvage buttons this panel used to have are gone.
 *
 * EQUIP FLOW (unchanged from M7): POST `/api/items/equip`|`unequip` FIRST —
 * only on success do we optimistically patch the local `inventory` slice AND
 * queue the engine's `equip` intent (`queueEquip`), so the sim's applied
 * stats and the server's item ledger can never disagree.
 *
 * SELL FLOW (M7.5): town-only (checked here AND re-enforced by the server's
 * own future position check, `server/items.ts`'s known v1 gap) — POST
 * `/api/items/sell` then, on success, remove the sold instances from the
 * local slice + queue the engine `goldCredit` intent (`ui/gear/sellFlow.ts`'s
 * `executeSell`, shared with the bot's auto-sell executor in `GameClient.tsx`).
 * Equipped items never show a sell button (the server would reject them
 * anyway, `reason: "equipped"`).
 */

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  FORTIFIER_FOR_SLOT,
  INVENTORY_CAP,
  isLegendaryTemplate,
  lookupTemplate,
  type GearSlot,
  type HeroClass,
  type StatKey,
} from "@/engine";
import { executeAwakenLegendary } from "@/ui/asura/awakenFlow";
import { awakenGate } from "@/ui/asura/awakenView";
import { fetchInventory, postEquip, postUnequip } from "@/ui/gear/api";
import { applyEquipChange, applyUnequipChange } from "@/ui/gear/inventoryOps";
import { executeSell } from "@/ui/gear/sellFlow";
import { compareInventoryItems, refinedStatsOf, sellAllCommonIds } from "@/ui/gear/sortRank";
import { computeStatDelta } from "@/ui/gear/statDelta";
import { useConfirmGuard } from "@/ui/gear/useConfirmGuard";
import { toInventoryItem, type InventoryItem } from "@/ui/gear/types";
import { EquipmentDoll } from "@/ui/components/EquipmentDoll";
import { BagIcon, MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { ItemTile } from "@/ui/components/primitives/ItemTile";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { TabRow } from "@/ui/components/primitives/TabRow";
import { classTintClass, GEAR_SLOT_ICONS, gearNameClass, HERO_ICONS, RARITY_COLORS, weaponGlyph } from "@/ui/labels";
import { useGameStore, type HeroSummary } from "@/ui/store/gameStore";

const SLOT_ORDER: readonly GearSlot[] = ["weapon", "armor"];

/** Fixed display order (matches `StatPanel.tsx`'s `STAT_ORDER` — the engine
 * only has these 4 allocatable axes, no 5th "AGI" axis exists to show). */
const STAT_ORDER: readonly StatKey[] = ["str", "dex", "int", "vit"];

/**
 * R2-W3 "sweep แผงตาม mockup" — the EQUIPMENT panel's read-only stat column
 * (mockup: STR/DEX/INT/VIT + พลังต่อสู้ beside the paper-doll). Presentational
 * only, off the same throttled `HeroSummary` snapshot `StatPanel.tsx` reads —
 * this is NOT a second stat-allocation surface (no +buttons here; allocating
 * still lives exclusively in `StatPanel.tsx`, avoiding two places that "spend
 * a point" per the one-mental-model-per-feature rule).
 */
function EquipStatBlock({ hero, className = "" }: { hero: HeroSummary; className?: string }) {
  const t = useTranslations("stats");
  return (
    <div
      className={`flex shrink-0 flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 p-2.5 ${className}`}
    >
      <span className="text-center text-[10px] font-bold tracking-wide text-ddp-ink-muted uppercase">
        {t("title")}
      </span>
      <div className="flex flex-row flex-wrap gap-x-3 gap-y-1 md:flex-col md:flex-nowrap md:gap-y-1.5">
        {STAT_ORDER.map((stat) => (
          <div key={stat} className="flex min-h-4 items-center justify-between gap-2 text-xs">
            <span
              className={`font-semibold ${
                hero.primaryStat === stat ? "text-ddp-gold-bright" : "text-ddp-ink-muted"
              }`}
            >
              {t(`names.${stat}`)}
            </span>
            <span className="font-bold tabular-nums text-ddp-ink">{hero.stats[stat]}</span>
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-ddp-border-soft/60 pt-1.5 text-xs">
        <span className="font-semibold text-ddp-ink-muted">{t("combatPower")}</span>
        <span className="font-black tabular-nums text-ddp-gold-bright">
          {hero.combatPower.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function GridCell({
  item,
  isNew,
  selected,
  onSelect,
}: {
  item: InventoryItem;
  isNew: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const template = lookupTemplate(item.templateId);
  const tContent = useTranslations("content.items");
  const t = useTranslations("inventory");
  if (!template) return null; // stale/retired template — defensively skip

  const equipped = item.equippedSlot !== null;
  // "ตำราตำนาน" legendary (endgame v1.3): a distinct violet border/glow overrides the
  // ordinary tier-6 fallback (its tier, 11, is above every TIER_BORDER_COLORS band).
  const legendary = isLegendaryTemplate(item.templateId);
  // Owner ask 2026-07-08: weapon glyph reads by REQUIRED CLASS instead of one
  // universal crossed-blade; armor keeps its generic 🛡 but both get a subtle
  // per-class glyph tint when class-locked (weapons always are; armor only
  // when `classReq` isn't null — universal armor stays untinted).
  const glyph = template.slot === "weapon" ? weaponGlyph(template.classReq) : GEAR_SLOT_ICONS.armor;
  const tint = classTintClass(template.classReq);

  return (
    <ItemTile
      rarity={template.rarity}
      tier={template.tier}
      equipped={equipped}
      legendary={legendary}
      selected={selected}
      onClick={onSelect}
      ariaLabel={tContent(`${item.templateId}.name`)}
      glyph={glyph}
      glyphClassName={tint}
      templateId={item.templateId}
      subLabel={t("tierShort", { tier: template.tier })}
      refineBadge={item.refineLevel > 0 ? t("refinePlus", { level: item.refineLevel }) : undefined}
      // EQUIPPED must be unmistakable (owner ask): on-tile "ใส่อยู่" ribbon (not a corner dot).
      topRibbon={equipped ? t("equippedBadge") : undefined}
      // Armor's main glyph stays generic 🛡 (owner ask), so a class-locked armor piece
      // still gets this small required-class corner marker — weapons already carry
      // their class in the big glyph above now, so this would just duplicate it there.
      cornerBottomLeft={
        template.slot === "armor" && template.classReq ? (
          <span title={t("classNames." + template.classReq)}>{HERO_ICONS[template.classReq]}</span>
        ) : undefined
      }
      cornerTopLeft={
        isNew && !equipped ? (
          <span className="rounded-sm bg-rose-500 px-1 text-[8px] font-black text-white uppercase">
            {t("newBadge")}
          </span>
        ) : undefined
      }
    />
  );
}

function StatDeltaChips({
  candidateTemplateId,
  candidateRefineLevel,
  equippedTemplateId,
  equippedRefineLevel,
}: {
  candidateTemplateId: string;
  candidateRefineLevel: number;
  equippedTemplateId: string | null;
  equippedRefineLevel: number;
}) {
  const t = useTranslations("inventory");
  const candidate = lookupTemplate(candidateTemplateId);
  if (!candidate) return null;
  const equipped = equippedTemplateId ? lookupTemplate(equippedTemplateId) : null;
  // M7.6 ตีบวก: compare REFINED stat blocks (both sides), not raw catalog stats
  // — a +7 sword genuinely out-damages a +0 of the same template.
  const candidateStats = refinedStatsOf(candidate, candidateRefineLevel);
  const entries = computeStatDelta(
    candidateStats,
    equipped ? refinedStatsOf(equipped, equippedRefineLevel) : null,
  );

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 text-[10px] font-bold tabular-nums">
      {entries.map((e) => (
        <span
          key={e.key}
          className={
            e.delta > 0
              ? "text-emerald-400"
              : e.delta < 0
                ? "text-rose-400"
                : "text-ddp-ink-muted"
          }
        >
          {t(`stat${e.key === "atk" ? "Atk" : e.key === "def" ? "Def" : "Hp"}`, {
            value: candidateStats[e.key] ?? 0,
          })}
          {equippedTemplateId &&
            (e.delta > 0 ? ` (+${e.delta})` : e.delta < 0 ? ` (${e.delta})` : "")}
        </span>
      ))}
    </div>
  );
}

function DetailCard({
  item,
  heroCls,
  equippedTemplateId,
  equippedRefineLevel,
  inTown,
  busy,
  onEquip,
  onUnequip,
  onSell,
}: {
  item: InventoryItem;
  heroCls: HeroClass;
  equippedTemplateId: string | null;
  equippedRefineLevel: number;
  inTown: boolean;
  busy: boolean;
  onEquip: (item: InventoryItem) => void;
  onUnequip: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
}) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const tTome = useTranslations("asura.tome");
  const template = lookupTemplate(item.templateId);
  const sellGuard = useConfirmGuard();
  // Awakening ("ปลุกพลัง") reads the same live gold/stone balances as the tome panel.
  const gold = useGameStore((s) => s.gold);
  const materials = useGameStore((s) => s.materials);
  const pushNotice = useGameStore((s) => s.pushNotice);
  const [awakening, setAwakening] = useState(false);
  if (!template) return null;

  const equipped = item.equippedSlot !== null;
  const classBlocked = template.classReq !== null && template.classReq !== heroCls;
  const colors = RARITY_COLORS[template.rarity];
  const needsConfirm = template.rarity === "rare" || template.rarity === "epic";
  // M7.6+ polish: +8 and up gets prestige-gold name styling; a "ตำราตำนาน" legendary
  // (endgame v1.3, craft-only — never sold) always gets the gold-violet gradient instead.
  const prestigeCls = gearNameClass(item.templateId, item.refineLevel);
  const legendary = isLegendaryTemplate(item.templateId);
  // "ปลุกพลัง" awaken affordance (legendaries only) — the shared pure gate (server order).
  const awaken = legendary ? awakenGate(item.templateId, item.refineLevel, gold, materials) : null;

  function handleSell(): void {
    sellGuard.trigger(needsConfirm, () => onSell(item));
  }

  async function handleAwaken(): Promise<void> {
    if (awakening) return;
    setAwakening(true);
    const res = await executeAwakenLegendary(item.instanceId);
    setAwakening(false);
    if (res.ok) {
      pushNotice("asuraAwakened", { level: res.refineLevel });
    } else {
      pushNotice("asuraAwakenFailed", { reason: tTome(`awaken.error.${res.reason}`) });
    }
  }

  const glyph = template.slot === "weapon" ? weaponGlyph(template.classReq) : GEAR_SLOT_ICONS.armor;
  const tint = classTintClass(template.classReq);

  return (
    <div
      className={`flex flex-col gap-2 rounded-(--ddp-radius-md) border p-3 ${
        equipped ? "border-emerald-400/70 bg-emerald-400/5" : "border-ddp-border-soft bg-black/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={`text-2xl ${tint}`}>
          {glyph}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`truncate text-sm ${prestigeCls || `font-bold ${colors.text}`}`}>
            {colors.icon} {tContent(`${item.templateId}.name`)}
            {item.refineLevel > 0 && (
              <span className={prestigeCls || "text-emerald-400"}>
                {" "}
                {t("refinePlus", { level: item.refineLevel })}
              </span>
            )}
          </span>
          <span className="text-[10px] text-ddp-ink-muted">
            {t("tierLabel", { tier: template.tier })} · {t(`rarity.${template.rarity}`)}
            {equipped && (
              <span className="ml-1.5 rounded-full bg-emerald-400/20 px-1.5 py-0.5 font-bold text-emerald-300">
                {t("equippedBadge")}
              </span>
            )}
          </span>
        </div>
      </div>

      <StatDeltaChips
        candidateTemplateId={item.templateId}
        candidateRefineLevel={item.refineLevel}
        equippedTemplateId={equipped ? null : equippedTemplateId}
        equippedRefineLevel={equippedRefineLevel}
      />

      <div className="flex flex-wrap gap-2">
        {equipped ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUnequip(item)}
            className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted disabled:opacity-50"
          >
            {t("unequipButton")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || classBlocked}
            title={
              classBlocked && template.classReq
                ? t("classReqBlocked", { cls: t(`classNames.${template.classReq}`) })
                : undefined
            }
            onClick={() => onEquip(item)}
            className={`min-h-11 flex-1 rounded-(--ddp-radius-md) border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
              classBlocked
                ? "border-ddp-border bg-black/30 text-ddp-ink-muted"
                : "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
            }`}
          >
            {t("equipButton")}
          </button>
        )}

        {/* "ตำราตำนาน" legendary (endgame v1.3): bind-on-craft, never sellable — no button. */}
        {!equipped && !legendary && (
          <button
            type="button"
            disabled={busy || !inTown}
            title={!inTown ? t("sellTownOnly") : undefined}
            onClick={handleSell}
            className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-amber-400/60 bg-amber-400/10 px-3 text-xs font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sellGuard.confirming ? t("confirmSell") : t("sellButton")}
          </button>
        )}
      </div>

      {/* "ปลุกพลัง" AWAKENING (endgame v1.3) — the legendary's guaranteed +0..+5 progression
          path (the smith's refine station rejects legendaries). 100% success, never breaks. */}
      {awaken && (
        <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-fuchsia-400/30 bg-fuchsia-400/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-fuchsia-200">
              <span aria-hidden>🔮</span>
              {tTome("awaken.title")}
            </span>
            <span className="shrink-0 text-[11px] font-black tabular-nums text-fuchsia-300">
              {tTome("awaken.levelReadout", { current: awaken.current, max: awaken.max })}
            </span>
          </div>
          {awaken.status === "maxed" ? (
            <p className="text-center text-[11px] font-bold text-emerald-300">{tTome("awaken.maxed")}</p>
          ) : (
            <button
              type="button"
              disabled={awakening || awaken.status !== "ready"}
              onClick={() => void handleAwaken()}
              className="min-h-10 w-full rounded-(--ddp-radius-md) border border-fuchsia-400 bg-fuchsia-400/15 px-3 text-[12px] font-black text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {awakening
                ? tTome("awaken.awakeningButton")
                : awaken.status === "gold"
                  ? tTome("awaken.needGold")
                  : awaken.status === "stones"
                    ? tTome("awaken.needStones")
                    : tTome("awaken.buttonCost", {
                        target: awaken.target,
                        gold: awaken.cost.gold.toLocaleString(),
                        stones: awaken.cost.stones.toLocaleString(),
                      })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface InventoryPanelProps {
  onClose: () => void;
}

export function InventoryPanel({ onClose }: InventoryPanelProps) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  // ดินแดนอสูร (endgame v1): accrual-only, mysterious tone — see the module's
  // asuraEssence doc (never named as a recipe ingredient anywhere in copy).
  const asuraEssence = useGameStore((s) => s.asuraEssence);
  // "ตำราตำนาน" secret-quest pages (endgame v1.3) — same mysterious-tone chip
  // precedent as `asuraEssence` above; hidden again once the tome is unlocked
  // (the real "⚒️ ตำราตำนาน" main-menu entry takes over from there).
  const tomePagesFound = useGameStore((s) => s.tomePagesFound);
  const tomeUnlocked = useGameStore((s) => s.tomeUnlocked);
  const hero = useGameStore((s) => s.heroes[0]);
  const heroCls = hero?.cls;
  const inTown = useGameStore((s) => s.world.kind === "town");
  const sessionKnownTemplateIds = useGameStore((s) => s.sessionKnownTemplateIds);
  const setInventory = useGameStore((s) => s.setInventory);
  const queueEquip = useGameStore((s) => s.queueEquip);

  // R2-W? "all" tab default (owner-visible decision): the bag opens showing
  // every owned instance across both slots instead of forcing a weapon/armor
  // pick first. `GearSlot | "all"` widens ONLY this panel's own tab state —
  // `EquipmentDoll`/`handleSelectRealSlot` stay strictly `GearSlot`-typed
  // (equipping/tapping a real slot always narrows back to that slot).
  const [activeTab, setActiveTab] = useState<GearSlot | "all">("all");
  const [classOnly, setClassOnly] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // M7.9 "no stacking" — every owned instance is its own tile, sorted
  // BEST -> WORST (see `compareInventoryItems`). World-boss wave: "แกร่ง"
  // fortifiers reuse a gear `slot` as their MATCH key (not an equip slot), so
  // they're excluded from this equip/sell grid entirely — see the dedicated
  // owned-fortifier readout below instead (no equip/sell affordances for them).
  const items = useMemo(() => {
    return inventory
      .filter((i) => activeTab === "all" || i.slot === activeTab)
      .filter((i) => lookupTemplate(i.templateId)?.kind !== "fortifier")
      .filter((i) => {
        if (!classOnly || !heroCls) return true;
        const tpl = lookupTemplate(i.templateId);
        return !tpl || tpl.classReq === null || tpl.classReq === heroCls;
      })
      .sort(compareInventoryItems);
  }, [inventory, activeTab, classOnly, heroCls]);

  // World-boss wave: owned "แกร่ง" fortifier counts (weapon/armor) — inert
  // readout only (consumed via the refine panel's guaranteed-success button,
  // never equipped/sold here).
  const fortifierCounts = useMemo(() => {
    const weapon = inventory.filter((i) => i.templateId === FORTIFIER_FOR_SLOT.weapon).length;
    const armor = inventory.filter((i) => i.templateId === FORTIFIER_FOR_SLOT.armor).length;
    return { weapon, armor };
  }, [inventory]);

  const selectedItem = items.find((i) => i.instanceId === selectedInstanceId) ?? null;
  // Under the "all" tab, items span both slots, so "the equipped item to
  // compare against" can't just be "whatever's equipped in activeTab" — it
  // has to follow the SELECTED item's own slot. Falls back to activeTab when
  // nothing's selected yet (mirrors the old single-slot-tab behavior).
  const equippedCompareSlot = selectedItem ? selectedItem.slot : activeTab !== "all" ? activeTab : null;
  const equippedItem = equippedCompareSlot
    ? (inventory.find((i) => i.equippedSlot === equippedCompareSlot) ?? null)
    : null;
  const equippedTemplateId = equippedItem?.templateId ?? null;
  const equippedRefineLevel = equippedItem?.refineLevel ?? 0;

  async function resync(): Promise<void> {
    const res = await fetchInventory();
    if (res) setInventory(res.items.map(toInventoryItem));
  }

  async function handleEquip(target: InventoryItem): Promise<void> {
    if (target.equippedSlot !== null) return;
    setBusy(true);
    const res = await postEquip(target.instanceId);
    if (res.ok) {
      setInventory(applyEquipChange(inventory, target.instanceId, target.slot));
      // M7.6 ตีบวก: carry the item's refine level so the sim applies the
      // RIGHT stats immediately (a +7 sword must never equip as if +0).
      queueEquip(target.slot, target.templateId, target.refineLevel);
    } else {
      await resync();
    }
    setBusy(false);
  }

  async function handleUnequip(target: InventoryItem): Promise<void> {
    if (target.equippedSlot === null) return;
    setBusy(true);
    const res = await postUnequip(target.instanceId);
    if (res.ok) {
      setInventory(applyUnequipChange(inventory, target.instanceId));
      queueEquip(target.slot, null);
    } else {
      await resync();
    }
    setBusy(false);
  }

  async function handleSell(target: InventoryItem): Promise<void> {
    if (target.equippedSlot !== null) return;
    setBusy(true);
    await executeSell([target.instanceId]);
    setBusy(false);
  }

  async function handleSellAllCommon(): Promise<void> {
    const ids = sellAllCommonIds(inventory);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSell(ids);
    setBusy(false);
  }

  // Paper-doll real-slot tap: same destination as tapping the item's own
  // grid tile (activeTab + selectedInstanceId) — no new state shape.
  function handleSelectRealSlot(slot: GearSlot, instanceId: string | null): void {
    setActiveTab(slot);
    setSelectedInstanceId(instanceId);
  }

  if (!hero || !heroCls) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <button
        type="button"
        aria-label={t("closeButton")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <Panel
        variant="gold"
        className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-hidden md:max-w-2xl"
      >
        <PanelHeader
          title={t("title")}
          icon={<BagIcon className="h-5 w-5" />}
          actions={
            <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
              ✕ {t("closeButton")}
            </Button>
          }
        />

        {/* Paper-doll (approved audit design): pinned LEFT column on desktop,
            pinned horizontal strip above the tabs on mobile — outside the
            bag's own overflow-y-auto container, same tier as the capacity
            bar/tabs below, so it never scrolls away.
            NOTE: no `items-start` on the md:flex-row axis — that would
            override the default cross-axis stretch, leaving the bag column
            sized to its own (unbounded) content instead of the row's actual
            available height, which is exactly what let the bag grid below
            grow past the modal's bottom rounded edge on desktop (owner
            screenshot). Stretch (default) keeps both columns pinned to the
            row's height so the bag's `min-h-0`/`overflow-y-auto` chain has
            something bounded to clip against. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4">
        <div className="flex shrink-0 flex-col items-center gap-3 md:flex-row md:items-start">
          <EquipmentDoll
            inventory={inventory}
            // Doll real-slot highlight stays a strict `GearSlot` — under "all"
            // it follows the SELECTED item's slot (falls back to "weapon" when
            // nothing's selected yet; purely cosmetic, doesn't affect filtering).
            activeTab={activeTab === "all" ? (selectedItem?.slot ?? "weapon") : activeTab}
            onSelectReal={handleSelectRealSlot}
            heroCls={heroCls}
            heroLevel={hero.level}
            className="md:w-52"
          />
          <EquipStatBlock hero={hero} className="w-full max-w-60 md:w-28" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">

        {/* Capacity bar + materials readout (M7.6 ตีบวก) */}
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full bg-ddp-gold"
              style={{
                width: `${Math.min(100, (inventory.length / INVENTORY_CAP) * 100)}%`,
              }}
            />
          </div>
          <span className="shrink-0 text-[10px] font-bold tabular-nums text-ddp-ink-muted">
            {t("capacityLabel", { count: inventory.length, cap: INVENTORY_CAP })}
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-violet-300">
            <MaterialIcon className="h-3 w-3" />
            {materials.toLocaleString()}
          </span>
          {/* ดินแดนอสูร essence (endgame v1) — hidden until the player has ever
              gotten one (mirrors the fortifier chips below), mysterious tone. */}
          {asuraEssence > 0 && (
            <span
              title={t("asuraEssenceHint")}
              className="flex shrink-0 items-center gap-1 rounded-full border border-red-800/50 bg-red-950/25 px-2 py-0.5 text-[10px] font-bold tabular-nums text-red-300"
            >
              <span aria-hidden>✨</span>
              {asuraEssence.toLocaleString()}
            </span>
          )}
          {/* "ตำราตำนาน" secret-quest burnt pages (endgame v1.3) — same mysterious-tone,
              hide-until-owned chip as the essence one above; disappears once the tome is
              unlocked (the real menu entry takes over). */}
          {tomePagesFound > 0 && !tomeUnlocked && (
            <span
              title={t("tomePagesHint")}
              className="flex shrink-0 items-center gap-1 rounded-full border border-amber-800/50 bg-amber-950/25 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-300"
            >
              <span aria-hidden>?</span>
              {tomePagesFound}/3
            </span>
          )}
        </div>

        {/* World-boss wave: owned "แกร่ง" fortifier readout (inert — no equip/sell
            here, spend them at ลุงดึ๋ง's refine panel). Hidden when both are 0. */}
        {(fortifierCounts.weapon > 0 || fortifierCounts.armor > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {fortifierCounts.weapon > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-violet-300">
                <span aria-hidden>⚔</span> {tContent("fort_weapon.name")} ×{fortifierCounts.weapon}
              </span>
            )}
            {fortifierCounts.armor > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-violet-300">
                <span aria-hidden>🛡</span> {tContent("fort_armor.name")} ×{fortifierCounts.armor}
              </span>
            )}
          </div>
        )}

        {/* Tabs — "all" leads (default tab), then the per-slot tabs. */}
        <TabRow<GearSlot | "all">
          tabs={[
            { id: "all", label: t("slot.all"), icon: <BagIcon className="h-3.5 w-3.5" /> },
            ...SLOT_ORDER.map((slot) => ({
              id: slot,
              label: t(`slot.${slot}`),
              icon: GEAR_SLOT_ICONS[slot],
            })),
          ]}
          active={activeTab}
          onChange={(tab) => {
            setActiveTab(tab);
            setSelectedInstanceId(null);
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setClassOnly((v) => !v)}
            aria-pressed={classOnly}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-bold ${
              classOnly
                ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
                : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
            }`}
          >
            {t("classOnlyToggle")}
          </button>
          <button
            type="button"
            disabled={busy || !inTown}
            title={!inTown ? t("sellTownOnly") : undefined}
            onClick={handleSellAllCommon}
            className="min-h-11 rounded-(--ddp-radius-md) border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("sellAllCommonButton")}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {/* R2-W3: pinned at 4 columns (was `sm:grid-cols-5`) — the paper-doll
              grew a character portrait + stat column beside it this wave, and
              the modal's own width is capped (`md:max-w-2xl`) regardless of
              viewport, so 5 columns' 64px-tile minimum no longer leaves enough
              room; 4 keeps every tile a real, un-squeezed touch target. */}
          {items.length === 0 ? (
            <p className="text-[11px] text-ddp-ink-muted/70">{t("emptySlotHint")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {items.map((it) => (
                <GridCell
                  key={it.instanceId}
                  item={it}
                  isNew={!sessionKnownTemplateIds.includes(it.templateId)}
                  selected={selectedInstanceId === it.instanceId}
                  onSelect={() =>
                    setSelectedInstanceId((cur) => (cur === it.instanceId ? null : it.instanceId))
                  }
                />
              ))}
            </div>
          )}

          {selectedItem && (
            <DetailCard
              item={selectedItem}
              heroCls={heroCls}
              equippedTemplateId={equippedTemplateId}
              equippedRefineLevel={equippedRefineLevel}
              inTown={inTown}
              busy={busy}
              onEquip={handleEquip}
              onUnequip={handleUnequip}
              onSell={handleSell}
            />
          )}
        </div>
        </div>
        </div>
      </Panel>
    </div>
    </ModalPortal>
  );
}
