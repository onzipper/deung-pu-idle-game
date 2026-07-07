"use client";

/**
 * NPC shop panel (M6 "เมืองหลัก + NPC shops"; converted to ป้าปุ๊'s tap-again-to-talk
 * dialog by Town NPCs phase 3, final) — simple buy rows: icon + name, the
 * stage-scaled price, the owned/cap count, and +1 / +5 buy buttons. The buy queues
 * a `buyShopItem` intent (drained once per frame by GameClient); the engine no-ops
 * an unaffordable / over-cap purchase, so the buttons just grey out to match.
 *
 * UAT (2026-07-08c+): a second "ขาย·ย่อย" tab reuses the EXACT sell/salvage
 * flows `InventoryPanel.tsx` uses (`executeSell`/`executeSalvage`, the shared
 * `ui/gear/sortRank.ts` best-first ordering + bulk id-pickers, and the
 * `SellSalvageRow` row component for the tap-again-to-confirm guard) — no
 * forked logic. The panel deliberately stays open after each sell/salvage
 * (hammerable), unlike the buy tab's queue-and-forget buttons.
 *
 * Same modal shell convention as `RefinePanel.tsx` (fixed overlay via
 * `ModalPortal`, sim never pauses behind it) — opened ONLY by talking to ป้าปุ๊
 * (`GameClient.tsx`'s `talkToNpc`), never rendered unconditionally anymore; see
 * `TownNpcPanelHost.tsx` for the open/auto-close wiring. `onClose` is called both
 * by the ✕ button and by that host's walk-away watch.
 *
 * Icons are pre-2015 emoji (❤ / 💧 / 📜) so Windows 10 renders them (no Unicode-13+
 * glyphs — see CLAUDE.md footgun #4).
 */

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { ShopItemId } from "@/engine";
import { executeSalvage } from "@/ui/gear/salvageFlow";
import { executeSell } from "@/ui/gear/sellFlow";
import { compareInventoryItems, sellAllCommonIds, salvageJunkCommonIds } from "@/ui/gear/sortRank";
import type { InventoryItem } from "@/ui/gear/types";
import { MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { SellSalvageRow } from "@/ui/components/SellSalvageRow";
import { useGameStore } from "@/ui/store/gameStore";

const SHOP_ORDER: ShopItemId[] = ["hpPotion", "manaPotion", "returnScroll"];

const ITEM_ICON: Record<ShopItemId, string> = {
  hpPotion: "❤",
  manaPotion: "💧",
  returnScroll: "📜",
};

/** CSS-drawn coin (the 🪙 emoji has no glyph on Windows 10 — CLAUDE.md footgun #4;
 * mirrors HudBar's coin). */
function Coin() {
  return (
    <span
      aria-hidden
      className="relative inline-block h-3 w-3 shrink-0 rounded-full border-2 border-amber-600 bg-amber-400"
    >
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-black leading-none text-amber-700">
        ฿
      </span>
    </span>
  );
}

function BuyRow({ item }: { item: ShopItemId }) {
  const gold = useGameStore((s) => s.gold);
  const shop = useGameStore((s) => s.shop);
  const buy = useGameStore((s) => s.buyShopItem);
  const tContent = useTranslations("content.items");
  const t = useTranslations("shop");

  const price = shop.prices[item];
  const count = shop.counts[item];
  const atCap = count >= shop.stackCap;
  const canBuyOne = gold >= price && !atCap;

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 py-1.5">
      <span aria-hidden className="text-lg leading-none">
        {ITEM_ICON[item]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-ddp-ink">
          {tContent(`${item}.name`)}
        </span>
        <span className="truncate text-xs text-ddp-ink-muted">{tContent(`${item}.desc`)}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-ddp-gold-bright">
          <Coin />
          {price}
        </span>
        <span
          className={`text-xs tabular-nums ${atCap ? "text-emerald-400" : "text-ddp-ink-muted"}`}
        >
          {t("owned", { count, cap: shop.stackCap })}
        </span>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!canBuyOne}
          onClick={() => buy(item, 1)}
          aria-label={t("buyAria", { name: tContent(`${item}.name`), qty: 1 })}
          className={`min-h-11 min-w-11 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-all active:scale-95 ${
            canBuyOne
              ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:brightness-110"
              : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted/50"
          }`}
        >
          +1
        </button>
        <button
          type="button"
          disabled={!canBuyOne}
          onClick={() => buy(item, 5)}
          aria-label={t("buyAria", { name: tContent(`${item}.name`), qty: 5 })}
          className={`min-h-11 min-w-11 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-all active:scale-95 ${
            canBuyOne
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:brightness-110"
              : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted/50"
          }`}
        >
          +5
        </button>
      </div>
    </div>
  );
}

/** The sell/salvage tab body — a flat, best-first-sorted scan of every
 * UNEQUIPPED instance (see `ui/gear/sortRank.ts`), reusing the exact same
 * `executeSell`/`executeSalvage` flows and bulk id-pickers `InventoryPanel.tsx`
 * uses. Deliberately HAMMERABLE: no close-on-action, the list just re-anchors
 * itself as items disappear (plain `.map`, no local selection state to stale-
 * point at a gone instance). */
function SellSalvageTab() {
  const inventory = useGameStore((s) => s.inventory);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("inventory");
  const tShop = useTranslations("shop");

  const items = useMemo(
    () => inventory.filter((i) => i.equippedSlot === null).sort(compareInventoryItems),
    [inventory],
  );

  async function handleSell(target: InventoryItem): Promise<void> {
    setBusy(true);
    await executeSell([target.instanceId]);
    setBusy(false);
  }

  async function handleSalvage(target: InventoryItem): Promise<void> {
    setBusy(true);
    await executeSalvage([target.instanceId]);
    setBusy(false);
  }

  async function handleSellAllCommon(): Promise<void> {
    const ids = sellAllCommonIds(inventory);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSell(ids);
    setBusy(false);
  }

  async function handleSalvageJunkCommon(): Promise<void> {
    const ids = salvageJunkCommonIds(inventory);
    if (ids.length === 0) return;
    setBusy(true);
    await executeSalvage(ids);
    setBusy(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleSellAllCommon}
          className="min-h-11 rounded-(--ddp-radius-md) border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("sellAllCommonButton")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSalvageJunkCommon}
          className="flex min-h-11 items-center gap-1 rounded-(--ddp-radius-md) border border-violet-400/40 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-bold text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MaterialIcon className="h-3.5 w-3.5" />
          {t("salvageJunkCommonButton")}
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-[11px] text-ddp-ink-muted/70">{tShop("sellEmptyHint")}</p>
        ) : (
          items.map((it) => (
            <SellSalvageRow
              key={it.instanceId}
              item={it}
              busy={busy}
              onSell={handleSell}
              onSalvage={handleSalvage}
            />
          ))
        )}
      </div>
    </div>
  );
}

export interface ShopPanelProps {
  onClose: () => void;
}

export function ShopPanel({ onClose }: ShopPanelProps) {
  // Defensive second guard (mirrors `RefinePanel`'s own town-only belt-and-
  // suspenders) — `TownNpcPanelHost` already closes this the instant the
  // hero leaves town/range, but a stray render in between should never show
  // buy rows outside town.
  const inTown = useGameStore((s) => s.world.kind === "town");
  const t = useTranslations("shop");
  const tInv = useTranslations("inventory");
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");

  if (!inTown) return null;

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
          aria-label={tInv("closeButton")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-gold/40 bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ddp-gold-bright">
              <span aria-hidden>🏠</span> {t("title")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {tInv("closeButton")}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("buy")}
              aria-pressed={activeTab === "buy"}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-colors ${
                activeTab === "buy"
                  ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
                  : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
              }`}
            >
              {t("tabBuy")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("sell")}
              aria-pressed={activeTab === "sell"}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-colors ${
                activeTab === "sell"
                  ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
                  : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
              }`}
            >
              {t("tabSell")}
            </button>
          </div>

          {activeTab === "buy" ? (
            <>
              <span className="text-xs text-ddp-ink-muted">{t("subtitle")}</span>
              <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {SHOP_ORDER.map((item) => (
                  <BuyRow key={item} item={item} />
                ))}
              </div>
            </>
          ) : (
            <SellSalvageTab />
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
