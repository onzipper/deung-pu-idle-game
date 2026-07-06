"use client";

/**
 * M7.5 Inventory UX overhaul — a RO-style stacked GRID (replaces the M7 flat
 * per-instance list). Instances are identical v1, so owned items STACK by
 * templateId (`ui/gear/stacking.ts`'s `groupIntoStacks`) with a `×N` badge;
 * every stack-level action (equip/sell) resolves to ONE representative
 * instance id out of the group. Same modal shell convention as
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
  refinedStat,
  salvageYield,
  type GearSlot,
  type HeroClass,
  type ItemTemplate,
} from "@/engine";
import { fetchInventory, postEquip, postUnequip } from "@/ui/gear/api";
import { applyEquipChange, applyUnequipChange } from "@/ui/gear/inventoryOps";
import { executeSalvage } from "@/ui/gear/salvageFlow";
import { executeSell } from "@/ui/gear/sellFlow";
import { groupIntoStacks, type ItemStack } from "@/ui/gear/stacking";
import { computeStatDelta, type StatBlock } from "@/ui/gear/statDelta";
import { toInventoryItem } from "@/ui/gear/types";
import { MaterialIcon } from "@/ui/components/icons";
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

/** Stack-level selection key — compound `templateId:refineLevel` (M7.6), since
 * a +0 and a +5 copy of the same template are now separate `ItemStack`s (see
 * `ui/gear/stacking.ts`). */
function stackKey(stack: Pick<ItemStack, "templateId" | "refineLevel">): string {
  return `${stack.templateId}:${stack.refineLevel}`;
}

/** The template's flat stat block, refined to `refineLevel` (M7.6 ตีบวก — a
 * +0 item is byte-identical to its base template). */
function refinedStatsOf(template: ItemTemplate, refineLevel: number): StatBlock {
  return {
    atk: template.stats.atk ? refinedStat(template.stats.atk, refineLevel) : undefined,
    def: template.stats.def ? refinedStat(template.stats.def, refineLevel) : undefined,
    hp: template.stats.hp ? refinedStat(template.stats.hp, refineLevel) : undefined,
  };
}

/** Flat refined stat total (M7.6 ตีบวก) — used by the "salvage junk common"
 * bulk affordance to compare a candidate against what's equipped in its slot. */
function statSumOf(template: ItemTemplate, refineLevel: number): number {
  const s = refinedStatsOf(template, refineLevel);
  return (s.atk ?? 0) + (s.def ?? 0) + (s.hp ?? 0);
}

function GridCell({
  stack,
  isNew,
  selected,
  onSelect,
}: {
  stack: ItemStack;
  isNew: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const template = ITEM_TEMPLATES[stack.templateId];
  const tContent = useTranslations("content.items");
  const t = useTranslations("inventory");
  if (!template) return null; // stale/retired template — defensively skip

  const colors = RARITY_COLORS[template.rarity];
  const glow = RARITY_GLOW[template.rarity];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={tContent(`${stack.templateId}.name`)}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 bg-black/40 p-1.5 transition-transform duration-100 active:scale-95 ${tierBorder(
        template.tier,
      )} ${glow} ${selected ? "ring-2 ring-ddp-gold-bright" : ""}`}
    >
      <span aria-hidden className="text-xl leading-none">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <span className="text-[9px] font-bold text-ddp-ink-muted">
        {t("tierShort", { tier: template.tier })}
        {stack.refineLevel > 0 && (
          <span className="text-emerald-400"> {t("refinePlus", { level: stack.refineLevel })}</span>
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
      {stack.count > 1 && (
        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-ddp-gold px-1.5 py-0.5 text-[9px] font-black text-ddp-panel-strong">
          ×{stack.count}
        </span>
      )}
      {stack.equippedInstanceId && (
        <span className="absolute -top-1.5 -left-1.5 rounded-full bg-emerald-400 px-1 text-[9px] font-black text-emerald-950">
          E
        </span>
      )}
      {isNew && !stack.equippedInstanceId && (
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
  stack,
  heroCls,
  equippedTemplateId,
  equippedRefineLevel,
  inTown,
  busy,
  onEquip,
  onUnequip,
  onSellOne,
  onSellAll,
  onSalvageOne,
  onSalvageAll,
}: {
  stack: ItemStack;
  heroCls: HeroClass;
  equippedTemplateId: string | null;
  equippedRefineLevel: number;
  inTown: boolean;
  busy: boolean;
  onEquip: (stack: ItemStack) => void;
  onUnequip: (stack: ItemStack) => void;
  onSellOne: (stack: ItemStack) => void;
  onSellAll: (stack: ItemStack) => void;
  onSalvageOne: (stack: ItemStack) => void;
  onSalvageAll: (stack: ItemStack) => void;
}) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = ITEM_TEMPLATES[stack.templateId];
  const [confirmingSell, setConfirmingSell] = useState(false);
  const [confirmingSalvage, setConfirmingSalvage] = useState(false);
  if (!template) return null;

  const equipped = stack.equippedInstanceId !== null;
  const classBlocked = template.classReq !== null && template.classReq !== heroCls;
  const colors = RARITY_COLORS[template.rarity];
  const needsConfirm = template.rarity === "rare" || template.rarity === "epic";
  const sellableCount = stack.unequippedIds.length;
  // M7.6 ตีบวก: preview the material yield BEFORE salvaging (spec — the server
  // rolls nothing here, `salvageYield` is a pure tier/rarity table read).
  const perItemYield = salvageYield(template.tier, template.rarity);
  // M7.6+ polish: +8 and up gets prestige-gold name styling (see ui/labels.ts).
  const prestigeCls = prestigeNameClass(stack.refineLevel);

  function handleSell(all: boolean): void {
    if (needsConfirm && !confirmingSell) {
      setConfirmingSell(true);
      return;
    }
    setConfirmingSell(false);
    if (all) onSellAll(stack);
    else onSellOne(stack);
  }

  function handleSalvage(all: boolean): void {
    if (needsConfirm && !confirmingSalvage) {
      setConfirmingSalvage(true);
      return;
    }
    setConfirmingSalvage(false);
    if (all) onSalvageAll(stack);
    else onSalvageOne(stack);
  }

  return (
    <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-2xl">
          {GEAR_SLOT_ICONS[template.slot]}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`truncate text-sm ${prestigeCls || `font-bold ${colors.text}`}`}>
            {colors.icon} {tContent(`${stack.templateId}.name`)}
            {stack.refineLevel > 0 && (
              <span className={prestigeCls || "text-emerald-400"}>
                {" "}
                {t("refinePlus", { level: stack.refineLevel })}
              </span>
            )}
          </span>
          <span className="text-[10px] text-ddp-ink-muted">
            {t("tierLabel", { tier: template.tier })} · {t(`rarity.${template.rarity}`)}
          </span>
        </div>
      </div>

      <StatDeltaChips
        candidateTemplateId={stack.templateId}
        candidateRefineLevel={stack.refineLevel}
        equippedTemplateId={equipped ? null : equippedTemplateId}
        equippedRefineLevel={equippedRefineLevel}
      />

      <div className="flex flex-wrap gap-2">
        {equipped ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUnequip(stack)}
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
            onClick={() => onEquip(stack)}
            className={`min-h-11 flex-1 rounded-(--ddp-radius-md) border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
              classBlocked
                ? "border-ddp-border bg-black/30 text-ddp-ink-muted"
                : "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
            }`}
          >
            {t("equipButton")}
          </button>
        )}

        {sellableCount > 0 && (
          <>
            <button
              type="button"
              disabled={busy || !inTown}
              title={!inTown ? t("sellTownOnly") : undefined}
              onClick={() => handleSell(false)}
              className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-amber-400/60 bg-amber-400/10 px-3 text-xs font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirmingSell ? t("confirmSell") : t("sellOneButton")}
            </button>
            {sellableCount > 1 && (
              <button
                type="button"
                disabled={busy || !inTown}
                title={!inTown ? t("sellTownOnly") : undefined}
                onClick={() => handleSell(true)}
                className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-amber-400/40 bg-amber-400/5 px-3 text-xs font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {confirmingSell
                  ? t("confirmSell")
                  : t("sellAllButton", { count: sellableCount })}
              </button>
            )}
          </>
        )}
      </div>

      {sellableCount > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !inTown}
            title={!inTown ? t("sellTownOnly") : undefined}
            onClick={() => handleSalvage(false)}
            className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-(--ddp-radius-md) border border-violet-400/50 bg-violet-400/10 px-3 text-xs font-bold text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MaterialIcon className="h-3.5 w-3.5" />
            {confirmingSalvage
              ? t("confirmSalvage")
              : t("salvageOneButton", { yield: perItemYield })}
          </button>
          {sellableCount > 1 && (
            <button
              type="button"
              disabled={busy || !inTown}
              title={!inTown ? t("sellTownOnly") : undefined}
              onClick={() => handleSalvage(true)}
              className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-(--ddp-radius-md) border border-violet-400/30 bg-violet-400/5 px-3 text-xs font-bold text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MaterialIcon className="h-3.5 w-3.5" />
              {confirmingSalvage
                ? t("confirmSalvage")
                : t("salvageAllButton", {
                    count: sellableCount,
                    yield: perItemYield * sellableCount,
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
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  const heroCls = useGameStore((s) => s.heroes[0]?.cls);
  const inTown = useGameStore((s) => s.world.kind === "town");
  const sessionKnownTemplateIds = useGameStore((s) => s.sessionKnownTemplateIds);
  const setInventory = useGameStore((s) => s.setInventory);
  const queueEquip = useGameStore((s) => s.queueEquip);

  const [activeTab, setActiveTab] = useState<GearSlot>("weapon");
  const [classOnly, setClassOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allStacks = useMemo(() => groupIntoStacks(inventory), [inventory]);
  const stacks = useMemo(() => {
    return allStacks
      .filter((s) => s.slot === activeTab)
      .filter((s) => {
        if (!classOnly || !heroCls) return true;
        const tpl = ITEM_TEMPLATES[s.templateId];
        return !tpl || tpl.classReq === null || tpl.classReq === heroCls;
      })
      .sort((a, b) => {
        const tierDiff =
          (ITEM_TEMPLATES[b.templateId]?.tier ?? 0) - (ITEM_TEMPLATES[a.templateId]?.tier ?? 0);
        return tierDiff !== 0 ? tierDiff : b.refineLevel - a.refineLevel;
      });
  }, [allStacks, activeTab, classOnly, heroCls]);

  const equippedItem = inventory.find((i) => i.equippedSlot === activeTab) ?? null;
  const equippedTemplateId = equippedItem?.templateId ?? null;
  const equippedRefineLevel = equippedItem?.refineLevel ?? 0;
  const selectedStack = stacks.find((s) => stackKey(s) === selectedKey) ?? null;

  async function resync(): Promise<void> {
    const res = await fetchInventory();
    if (res) setInventory(res.items.map(toInventoryItem));
  }

  async function handleEquip(stack: ItemStack): Promise<void> {
    if (stack.unequippedIds.length === 0) return;
    const instanceId = stack.unequippedIds[0];
    setBusy(true);
    const res = await postEquip(instanceId);
    if (res.ok) {
      setInventory(applyEquipChange(inventory, instanceId, stack.slot));
      // M7.6 ตีบวก: carry the stack's refine level so the sim applies the
      // RIGHT stats immediately (a +7 sword must never equip as if +0).
      queueEquip(stack.slot, stack.templateId, stack.refineLevel);
    } else {
      await resync();
    }
    setBusy(false);
  }

  async function handleUnequip(stack: ItemStack): Promise<void> {
    if (!stack.equippedInstanceId) return;
    const instanceId = stack.equippedInstanceId;
    setBusy(true);
    const res = await postUnequip(instanceId);
    if (res.ok) {
      setInventory(applyUnequipChange(inventory, instanceId));
      queueEquip(stack.slot, null);
    } else {
      await resync();
    }
    setBusy(false);
  }

  async function handleSellOne(stack: ItemStack): Promise<void> {
    if (stack.unequippedIds.length === 0) return;
    setBusy(true);
    await executeSell([stack.unequippedIds[0]]);
    setBusy(false);
  }

  async function handleSellAll(stack: ItemStack): Promise<void> {
    if (stack.unequippedIds.length === 0) return;
    setBusy(true);
    await executeSell(stack.unequippedIds);
    setBusy(false);
  }

  async function handleSellAllCommon(): Promise<void> {
    const ids = inventory
      .filter((i) => i.equippedSlot === null)
      .filter((i) => ITEM_TEMPLATES[i.templateId]?.rarity === "common")
      .map((i) => i.instanceId);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSell(ids);
    setBusy(false);
  }

  async function handleSalvageOne(stack: ItemStack): Promise<void> {
    if (stack.unequippedIds.length === 0) return;
    setBusy(true);
    await executeSalvage([stack.unequippedIds[0]]);
    setBusy(false);
  }

  async function handleSalvageAll(stack: ItemStack): Promise<void> {
    if (stack.unequippedIds.length === 0) return;
    setBusy(true);
    await executeSalvage(stack.unequippedIds);
    setBusy(false);
  }

  /** M7.6 ตีบวก bulk affordance: "ย่อยของ common ทั้งหมดที่ต่ำกว่าของที่ใส่" —
   * every UNEQUIPPED common item whose refined stat total does not beat what's
   * currently worn in its slot (an empty slot keeps everything eligible, same
   * as the sell-side keep-guard's "nothing worn yet" case). */
  async function handleSalvageJunkCommon(): Promise<void> {
    const equippedSumBySlot = new Map<GearSlot, number>();
    for (const it of inventory) {
      if (!it.equippedSlot) continue;
      const tpl = ITEM_TEMPLATES[it.templateId];
      if (tpl) equippedSumBySlot.set(it.equippedSlot, statSumOf(tpl, it.refineLevel));
    }
    const ids = inventory
      .filter((i) => i.equippedSlot === null)
      .filter((i) => ITEM_TEMPLATES[i.templateId]?.rarity === "common")
      .filter((i) => {
        const tpl = ITEM_TEMPLATES[i.templateId];
        if (!tpl) return false;
        const baseline = equippedSumBySlot.get(tpl.slot);
        return baseline === undefined || statSumOf(tpl, i.refineLevel) <= baseline;
      })
      .map((i) => i.instanceId);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSalvage(ids);
    setBusy(false);
  }

  if (!heroCls) return null;

  return (
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
                setSelectedKey(null);
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
          {stacks.length === 0 ? (
            <p className="text-[11px] text-ddp-ink-muted/70">{t("emptySlotHint")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {stacks.map((stack) => {
                const key = stackKey(stack);
                return (
                  <GridCell
                    key={key}
                    stack={stack}
                    isNew={!sessionKnownTemplateIds.includes(stack.templateId)}
                    selected={selectedKey === key}
                    onSelect={() => setSelectedKey((cur) => (cur === key ? null : key))}
                  />
                );
              })}
            </div>
          )}

          {selectedStack && (
            <DetailCard
              stack={selectedStack}
              heroCls={heroCls}
              equippedTemplateId={equippedTemplateId}
              equippedRefineLevel={equippedRefineLevel}
              inTown={inTown}
              busy={busy}
              onEquip={handleEquip}
              onUnequip={handleUnequip}
              onSellOne={handleSellOne}
              onSellAll={handleSellAll}
              onSalvageOne={handleSalvageOne}
              onSalvageAll={handleSalvageAll}
            />
          )}
        </div>
      </div>
    </div>
  );
}
