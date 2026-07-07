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
 * Every tile action (equip/sell/salvage) now targets exactly ONE instance id —
 * no more "sell all of this stack" bulk action at the tile level (the
 * inventory-wide "sell all common"/"salvage junk common" bulk buttons above
 * the grid are unchanged, they already scan `inventory` directly — also in
 * `sortRank.ts`, shared with `ShopPanel.tsx`). Same modal shell convention as
 * `SettingsPanel.tsx`/`CodexPanel.tsx` (fixed overlay, sim never pauses
 * behind it).
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
  ITEM_TEMPLATES,
  INVENTORY_CAP,
  salvageYield,
  type GearSlot,
  type HeroClass,
} from "@/engine";
import { fetchInventory, postEquip, postUnequip } from "@/ui/gear/api";
import { applyEquipChange, applyUnequipChange } from "@/ui/gear/inventoryOps";
import { executeSalvage } from "@/ui/gear/salvageFlow";
import { executeSell } from "@/ui/gear/sellFlow";
import {
  compareInventoryItems,
  refinedStatsOf,
  sellAllCommonIds,
  salvageJunkCommonIds,
} from "@/ui/gear/sortRank";
import { computeStatDelta } from "@/ui/gear/statDelta";
import { useConfirmGuard } from "@/ui/gear/useConfirmGuard";
import { toInventoryItem, type InventoryItem } from "@/ui/gear/types";
import { MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import {
  GEAR_SLOT_ICONS,
  HERO_ICONS,
  prestigeNameClass,
  RARITY_COLORS,
  RARITY_GLOW,
  TIER_BORDER_COLORS,
} from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const SLOT_ORDER: readonly GearSlot[] = ["weapon", "armor"];

function tierBorder(tier: number): string {
  return TIER_BORDER_COLORS[tier] ?? TIER_BORDER_COLORS[6];
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
  const template = ITEM_TEMPLATES[item.templateId];
  const tContent = useTranslations("content.items");
  const t = useTranslations("inventory");
  if (!template) return null; // stale/retired template — defensively skip

  const colors = RARITY_COLORS[template.rarity];
  const glow = RARITY_GLOW[template.rarity];
  const equipped = item.equippedSlot !== null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={tContent(`${item.templateId}.name`)}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 bg-black/40 p-1.5 transition-transform duration-100 active:scale-95 ${tierBorder(
        template.tier,
      )} ${glow} ${selected ? "ring-2 ring-ddp-gold-bright" : ""}`}
    >
      <span aria-hidden className="text-xl leading-none">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <span className="text-[9px] font-bold text-ddp-ink-muted">
        {t("tierShort", { tier: template.tier })}
        {item.refineLevel > 0 && (
          <span className="text-emerald-400"> {t("refinePlus", { level: item.refineLevel })}</span>
        )}
      </span>
      {template.classReq && (
        <span
          aria-hidden
          className="absolute bottom-0.5 left-0.5 text-[10px] leading-none"
          title={t("classNames." + template.classReq)}
        >
          {HERO_ICONS[template.classReq]}
        </span>
      )}
      {colors.icon && (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 text-[10px] leading-none"
        >
          {colors.icon}
        </span>
      )}
      {equipped && (
        <span className="absolute -top-1.5 -left-1.5 rounded-full bg-emerald-400 px-1 text-[9px] font-black text-emerald-950">
          E
        </span>
      )}
      {isNew && !equipped && (
        <span className="absolute top-0.5 left-0.5 rounded-sm bg-rose-500 px-1 text-[8px] font-black text-white uppercase">
          {t("newBadge")}
        </span>
      )}
    </button>
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
  const candidate = ITEM_TEMPLATES[candidateTemplateId];
  if (!candidate) return null;
  const equipped = equippedTemplateId ? ITEM_TEMPLATES[equippedTemplateId] : null;
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
  onSalvage,
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
  onSalvage: (item: InventoryItem) => void;
}) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = ITEM_TEMPLATES[item.templateId];
  const sellGuard = useConfirmGuard();
  const salvageGuard = useConfirmGuard();
  if (!template) return null;

  const equipped = item.equippedSlot !== null;
  const classBlocked = template.classReq !== null && template.classReq !== heroCls;
  const colors = RARITY_COLORS[template.rarity];
  const needsConfirm = template.rarity === "rare" || template.rarity === "epic";
  // M7.6 ตีบวก: preview the material yield BEFORE salvaging (spec — the server
  // rolls nothing here, `salvageYield` is a pure tier/rarity table read).
  const perItemYield = salvageYield(template.tier, template.rarity);
  // M7.6+ polish: +8 and up gets prestige-gold name styling (see ui/labels.ts).
  const prestigeCls = prestigeNameClass(item.refineLevel);

  function handleSell(): void {
    sellGuard.trigger(needsConfirm, () => onSell(item));
  }

  function handleSalvage(): void {
    salvageGuard.trigger(needsConfirm, () => onSalvage(item));
  }

  return (
    <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-2xl">
          {GEAR_SLOT_ICONS[template.slot]}
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

        {!equipped && (
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

      {!equipped && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !inTown}
            title={!inTown ? t("sellTownOnly") : undefined}
            onClick={handleSalvage}
            className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-(--ddp-radius-md) border border-violet-400/50 bg-violet-400/10 px-3 text-xs font-bold text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MaterialIcon className="h-3.5 w-3.5" />
            {salvageGuard.confirming ? t("confirmSalvage") : t("salvageButton", { yield: perItemYield })}
          </button>
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
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  const heroCls = useGameStore((s) => s.heroes[0]?.cls);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const sessionKnownTemplateIds = useGameStore((s) => s.sessionKnownTemplateIds);
  const setInventory = useGameStore((s) => s.setInventory);
  const queueEquip = useGameStore((s) => s.queueEquip);

  const [activeTab, setActiveTab] = useState<GearSlot>("weapon");
  const [classOnly, setClassOnly] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // M7.9 "no stacking" — every owned instance is its own tile, sorted
  // BEST -> WORST (see `compareInventoryItems`).
  const items = useMemo(() => {
    return inventory
      .filter((i) => i.slot === activeTab)
      .filter((i) => {
        if (!classOnly || !heroCls) return true;
        const tpl = ITEM_TEMPLATES[i.templateId];
        return !tpl || tpl.classReq === null || tpl.classReq === heroCls;
      })
      .sort(compareInventoryItems);
  }, [inventory, activeTab, classOnly, heroCls]);

  const equippedItem = inventory.find((i) => i.equippedSlot === activeTab) ?? null;
  const equippedTemplateId = equippedItem?.templateId ?? null;
  const equippedRefineLevel = equippedItem?.refineLevel ?? 0;
  const selectedItem = items.find((i) => i.instanceId === selectedInstanceId) ?? null;

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

  async function handleSalvage(target: InventoryItem): Promise<void> {
    if (target.equippedSlot !== null) return;
    setBusy(true);
    await executeSalvage([target.instanceId]);
    setBusy(false);
  }

  /** M7.6 ตีบวก bulk affordance: "ย่อยของ common ทั้งหมดที่ต่ำกว่าของที่ใส่" —
   * see `sortRank.ts`'s `salvageJunkCommonIds` for the exact eligibility rule
   * (shared with `ShopPanel.tsx`'s sell tab). */
  async function handleSalvageJunkCommon(): Promise<void> {
    const ids = salvageJunkCommonIds(inventory);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSalvage(ids);
    setBusy(false);
  }

  if (!heroCls) return null;

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
      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
          >
            ✕ {t("closeButton")}
          </button>
        </div>

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
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5">
          {SLOT_ORDER.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => {
                setActiveTab(slot);
                setSelectedInstanceId(null);
              }}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-colors ${
                activeTab === slot
                  ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
                  : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
              }`}
            >
              <span aria-hidden>{GEAR_SLOT_ICONS[slot]}</span>
              {t(`slot.${slot}`)}
            </button>
          ))}
        </div>

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
          <button
            type="button"
            disabled={busy || !inTown}
            title={!inTown ? t("sellTownOnly") : undefined}
            onClick={handleSalvageJunkCommon}
            className="flex min-h-11 items-center gap-1 rounded-(--ddp-radius-md) border border-violet-400/40 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-bold text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MaterialIcon className="h-3.5 w-3.5" />
            {t("salvageJunkCommonButton")}
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="text-[11px] text-ddp-ink-muted/70">{t("emptySlotHint")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
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
              onSalvage={handleSalvage}
            />
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
