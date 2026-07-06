"use client";

/**
 * M7 Gear & Drops — inventory + equip modal. Same modal shell convention as
 * `SettingsPanel.tsx`/`CodexPanel.tsx` (fixed overlay, sim never pauses behind
 * it). Lists the active character's owned items grouped by slot (weapon /
 * armor) with an equip/unequip action per row.
 *
 * EQUIP FLOW (per the M7 task brief): POST `/api/items/equip` (or `unequip`)
 * FIRST — only on a server success do we (a) optimistically patch the local
 * `inventory` slice and (b) queue the engine's `equip` FrameInput intent via
 * `queueEquip` (drained once/frame by `GameClient`), so the sim's applied
 * stats and the server's item ledger can never disagree. On failure we queue
 * NOTHING and refetch `/api/items` to resync the slice with whatever the
 * server actually has (the local optimistic guess may be stale/wrong).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ITEM_TEMPLATES,
  type GearSlot,
  type HeroClass,
  type ItemTemplate,
} from "@/engine";
import { fetchInventory, postEquip, postUnequip } from "@/ui/gear/api";
import { applyEquipChange, applyUnequipChange } from "@/ui/gear/inventoryOps";
import { toInventoryItem } from "@/ui/gear/types";
import type { InventoryItem } from "@/ui/gear/types";
import { GEAR_SLOT_ICONS, RARITY_COLORS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const SLOT_ORDER: readonly GearSlot[] = ["weapon", "armor"];

function StatChips({
  template,
  t,
}: {
  template: ItemTemplate;
  t: ReturnType<typeof useTranslations>;
}) {
  const { atk, def, hp } = template.stats;
  return (
    <div className="flex flex-wrap gap-1 text-[10px] font-bold tabular-nums text-ddp-ink-muted">
      {atk !== undefined && <span>{t("statAtk", { value: atk })}</span>}
      {def !== undefined && <span>{t("statDef", { value: def })}</span>}
      {hp !== undefined && <span>{t("statHp", { value: hp })}</span>}
    </div>
  );
}

function ItemRow({
  item,
  heroCls,
  busy,
  onEquip,
  onUnequip,
}: {
  item: InventoryItem;
  heroCls: HeroClass;
  busy: boolean;
  onEquip: (item: InventoryItem) => void;
  onUnequip: (item: InventoryItem) => void;
}) {
  const t = useTranslations("inventory");
  const tContent = useTranslations("content.items");
  const template = ITEM_TEMPLATES[item.templateId];
  if (!template) return null; // stale/retired template — defensively skip

  const equipped = item.equippedSlot === template.slot;
  const classBlocked = template.classReq !== null && template.classReq !== heroCls;
  const blockedTooltip =
    classBlocked && template.classReq
      ? t("classReqBlocked", { cls: t(`classNames.${template.classReq}`) })
      : undefined;
  const colors = RARITY_COLORS[template.rarity];

  return (
    <div
      className={`flex items-center gap-2.5 rounded-(--ddp-radius-md) border ${colors.border} bg-black/40 px-2.5 py-2`}
    >
      <span aria-hidden className="text-lg">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={`truncate text-xs font-bold ${colors.text}`}>
          {colors.icon} {tContent(`${item.templateId}.name`)}
          {equipped && (
            <span className="ml-1.5 rounded-full bg-ddp-gold/20 px-1.5 py-0.5 align-middle text-[9px] font-bold text-ddp-gold-bright uppercase">
              {t("equippedBadge")}
            </span>
          )}
        </span>
        <span className="text-[10px] text-ddp-ink-muted">
          {t("tierLabel", { tier: template.tier })} · {t(`rarity.${template.rarity}`)}
        </span>
        <StatChips template={template} t={t} />
      </div>
      {equipped ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUnequip(item)}
          className="min-h-11 shrink-0 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted transition-transform duration-100 active:scale-95 disabled:opacity-50"
        >
          {t("unequipButton")}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || classBlocked}
          title={blockedTooltip}
          onClick={() => onEquip(item)}
          className={`min-h-11 shrink-0 rounded-(--ddp-radius-md) border px-3 text-xs font-bold transition-transform duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
            classBlocked
              ? "border-ddp-border bg-black/30 text-ddp-ink-muted"
              : "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
          }`}
        >
          {t("equipButton")}
        </button>
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
  const heroCls = useGameStore((s) => s.heroes[0]?.cls);
  const setInventory = useGameStore((s) => s.setInventory);
  const queueEquip = useGameStore((s) => s.queueEquip);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resync(): Promise<void> {
    const res = await fetchInventory();
    if (res) setInventory(res.items.map(toInventoryItem));
  }

  async function handleEquip(item: InventoryItem): Promise<void> {
    setBusyId(item.instanceId);
    const res = await postEquip(item.instanceId);
    if (res.ok) {
      setInventory(applyEquipChange(inventory, item.instanceId, item.slot));
      queueEquip(item.slot, item.templateId);
    } else {
      await resync();
    }
    setBusyId(null);
  }

  async function handleUnequip(item: InventoryItem): Promise<void> {
    setBusyId(item.instanceId);
    const res = await postUnequip(item.instanceId);
    if (res.ok) {
      setInventory(applyUnequipChange(inventory, item.instanceId));
      queueEquip(item.slot, null);
    } else {
      await resync();
    }
    setBusyId(null);
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

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {SLOT_ORDER.map((slot) => {
            const items = inventory.filter((i) => i.slot === slot);
            return (
              <section key={slot}>
                <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
                  <span aria-hidden>{GEAR_SLOT_ICONS[slot]}</span>
                  {t(`slot.${slot}`)}
                </h3>
                {items.length === 0 ? (
                  <p className="text-[11px] text-ddp-ink-muted/70">
                    {t("emptySlotHint")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <ItemRow
                        key={item.instanceId}
                        item={item}
                        heroCls={heroCls}
                        busy={busyId === item.instanceId}
                        onEquip={handleEquip}
                        onUnequip={handleUnequip}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
