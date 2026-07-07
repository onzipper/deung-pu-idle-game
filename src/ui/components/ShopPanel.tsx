"use client";

/**
 * NPC shop panel (M6 "เมืองหลัก + NPC shops"; converted to ป้าปุ๊'s tap-again-to-talk
 * dialog by Town NPCs phase 3, final) — simple buy rows: icon + name, the
 * stage-scaled price, the owned/cap count, and +1 / +5 buy buttons. The buy queues
 * a `buyShopItem` intent (drained once per frame by GameClient); the engine no-ops
 * an unaffordable / over-cap purchase, so the buttons just grey out to match.
 *
 * UAT (2026-07-08c+): a second "ขาย" tab reuses the EXACT sell flow
 * `InventoryPanel.tsx` uses (`executeSell`, the shared `ui/gear/sortRank.ts`
 * best-first ordering + bulk id-picker, and the `SellRow` row component for
 * the tap-again-to-confirm guard) — no forked logic. The panel deliberately
 * stays open after each sell (hammerable), unlike the buy tab's
 * queue-and-forget buttons. Owner request 2026-07-08 (หินเสริมพลัง final
 * wave): salvage is RETIRED (refine stones now drop directly from mobs
 * instead) — this tab used to be "ขาย·ย่อย" (`SellSalvageTab`/
 * `SellSalvageRow`), now sell-only.
 *
 * Same modal shell convention as `RefinePanel.tsx` (fixed overlay via
 * `ModalPortal`, sim never pauses behind it) — opened ONLY by talking to ป้าปุ๊
 * (`GameClient.tsx`'s `talkToNpc`), never rendered unconditionally anymore; see
 * `TownNpcPanelHost.tsx` for the open/auto-close wiring. `onClose` is called both
 * by the ✕ button and by that host's walk-away watch.
 *
 * Icons are pre-2015 emoji (❤ / 💧 / 📜 / 🌀) so Windows 10 renders them (no Unicode-13+
 * glyphs — see CLAUDE.md footgun #4).
 *
 * UAT "ซื้อคืน" (buy-back) — a THIRD tab reusing the same flow-module
 * convention (`ui/gear/buybackFlow.ts`'s `fetchBuybackList`/`executeBuyback`)
 * and the same `useConfirmGuard` tap-again-to-confirm as the sell tab's rows.
 * Unlike the sell tab, this one fetches from the server on tab open (and
 * refetches after every buy-back, success or fail — the window can shrink
 * server-side either way) rather than deriving from the local inventory slice.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ITEM_TEMPLATES, type ShopItemId } from "@/engine";
import {
  executeBuyback,
  fetchBuybackList,
  formatBuybackCountdown,
  type BuybackListEntry,
} from "@/ui/gear/buybackFlow";
import { executeSell } from "@/ui/gear/sellFlow";
import { sellPriceOf, sumSellPrices, toggleSelected } from "@/ui/gear/multiSelect";
import { compareInventoryItems, sellAllCommonIds } from "@/ui/gear/sortRank";
import type { InventoryItem } from "@/ui/gear/types";
import { useConfirmGuard } from "@/ui/gear/useConfirmGuard";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { SellRow } from "@/ui/components/SellRow";
import { GEAR_SLOT_ICONS, prestigeNameClass, RARITY_COLORS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

/** Local re-render cadence for the buy-back countdown text — a plain
 * component-local timer, NOT an engine/store sync (CLAUDE.md rule #3 is
 * scoped to per-frame GAME state; this is a once-per-30s wall-clock label
 * refresh on a small modal list). */
const COUNTDOWN_REFRESH_MS = 30_000;

const SHOP_ORDER: ShopItemId[] = ["hpPotion", "manaPotion", "returnScroll", "warpScroll"];

const ITEM_ICON: Record<ShopItemId, string> = {
  hpPotion: "❤",
  manaPotion: "💧",
  returnScroll: "📜",
  warpScroll: "🌀",
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

/** Action bar shown while `selectMode` is on, anchored at the bottom of the
 * sell tab (below the scrollable item list, which is the only scrolling
 * region in this tab — so the bar always stays visible/thumb-reachable
 * without extra CSS positioning). Own `useConfirmGuard` so its confirming
 * state resets for free on every mount, i.e. every time the parent re-enters
 * select mode (conditional render == fresh hook state, no manual reset API
 * needed). One confirm for the WHOLE batch (count + total), same guard
 * convention as every other sell affordance in this file. */
function SellSelectionBar({
  count,
  total,
  busy,
  onSelectAll,
  onClear,
  onCancel,
  onConfirmSell,
}: {
  count: number;
  total: number;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onCancel: () => void;
  onConfirmSell: () => void;
}) {
  const t = useTranslations("shop");
  const guard = useConfirmGuard();
  const disabled = busy || count === 0;

  return (
    <div className="flex flex-col gap-1.5 border-t border-ddp-border-soft pt-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAll}
          className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 text-[11px] font-bold text-ddp-ink-muted"
        >
          {t("selectAllButton")}
        </button>
        <button
          type="button"
          disabled={count === 0}
          onClick={onClear}
          className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 text-[11px] font-bold text-ddp-ink-muted disabled:opacity-40"
        >
          {t("clearSelectionButton")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 text-[11px] font-bold text-ddp-ink-muted"
        >
          {t("cancelSelectionButton")}
        </button>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => guard.trigger(count > 0, onConfirmSell)}
        className={`min-h-11 w-full rounded-(--ddp-radius-md) border px-3 text-sm font-bold transition-all active:scale-95 ${
          disabled
            ? "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted/50"
            : "border-amber-400/60 bg-amber-500/20 text-amber-200 hover:brightness-110"
        }`}
      >
        {guard.confirming
          ? t("sellSelectedConfirm", { count, total })
          : t("sellSelectedButton", { count, total })}
      </button>
    </div>
  );
}

/** The sell tab body — a flat, best-first-sorted scan of every UNEQUIPPED
 * instance (see `ui/gear/sortRank.ts`), reusing the exact same `executeSell`
 * flow and bulk id-picker `InventoryPanel.tsx` uses. Deliberately HAMMERABLE:
 * no close-on-action, the list just re-anchors itself as items disappear
 * (plain `.map`, no local selection state to stale-point at a gone instance
 * outside select mode).
 *
 * Owner request "ขาย item แบบเลือกหลายอัน" (multi-select sell): a
 * "เลือกหลายชิ้น" toggle enters selection mode — rows flip to
 * checkmark-toggle buttons (`SellRow`'s `selectMode`) and a sticky
 * `SellSelectionBar` appears with the summed total. Selling still goes
 * through `executeSell`, which already CHUNKS at `MAX_SELL_BATCH`
 * sequentially (see `sellFlow.ts`) — so no extra cap/chunk logic is needed
 * here even for a huge selection; "เลือกทั้งหมด" just selects every eligible
 * id and the existing flow handles the rest. */
function SellTab() {
  const inventory = useGameStore((s) => s.inventory);
  const [busy, setBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const t = useTranslations("inventory");
  const tShop = useTranslations("shop");

  const items = useMemo(
    () => inventory.filter((i) => i.equippedSlot === null).sort(compareInventoryItems),
    [inventory],
  );

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.includes(i.instanceId)),
    [items, selectedIds],
  );
  const selectedTotal = useMemo(() => sumSellPrices(selectedItems), [selectedItems]);

  function toggleSelectMode(): void {
    setSelectMode((v) => !v);
    setSelectedIds([]);
  }

  function handleToggleOne(target: InventoryItem): void {
    setSelectedIds((cur) => toggleSelected(cur, target.instanceId));
  }

  async function handleSell(target: InventoryItem): Promise<void> {
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

  async function handleSellSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    setBusy(true);
    await executeSell(selectedIds);
    setSelectedIds([]); // clear selection, stay open/in select mode (hammerable)
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
          onClick={toggleSelectMode}
          aria-pressed={selectMode}
          className={`min-h-11 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
            selectMode
              ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
              : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
          }`}
        >
          {tShop("multiSelectToggle")}
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-[11px] text-ddp-ink-muted/70">{tShop("sellEmptyHint")}</p>
        ) : (
          items.map((it) => (
            <SellRow
              key={it.instanceId}
              item={it}
              busy={busy}
              onSell={handleSell}
              selectMode={selectMode}
              selected={selectedIds.includes(it.instanceId)}
              onToggleSelect={handleToggleOne}
              price={selectMode ? sellPriceOf(it) : undefined}
            />
          ))
        )}
      </div>
      {selectMode && (
        <SellSelectionBar
          count={selectedIds.length}
          total={selectedTotal}
          busy={busy}
          onSelectAll={() => setSelectedIds(items.map((i) => i.instanceId))}
          onClear={() => setSelectedIds([])}
          onCancel={toggleSelectMode}
          onConfirmSell={() => void handleSellSelected()}
        />
      )}
    </div>
  );
}

/** One buy-back row — same list-row layout + rarity/tier styling as
 * `SellRow`, but sourced from the server buy-back list rather than the
 * local inventory slice. Always requires the tap-again-to-confirm guard
 * (unlike the sell tab, which only guards rare/epic) since every entry here
 * costs gold. */
function BuybackRow({
  entry,
  now,
  busy,
  onBuy,
}: {
  entry: BuybackListEntry;
  now: number;
  busy: boolean;
  onBuy: (entry: BuybackListEntry) => void;
}) {
  const t = useTranslations("shop");
  const tContent = useTranslations("content.items");
  const tInv = useTranslations("inventory");
  const gold = useGameStore((s) => s.gold);
  const guard = useConfirmGuard();

  const template = ITEM_TEMPLATES[entry.templateId];
  if (!template) return null;

  const colors = RARITY_COLORS[template.rarity];
  const prestigeCls = prestigeNameClass(entry.refineLevel);
  const countdown = formatBuybackCountdown(entry.expiresAt, now);
  const canAfford = gold >= entry.price;
  const disabled = busy || !canAfford;

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2 py-1.5">
      <span aria-hidden className="text-lg leading-none">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={`truncate text-xs ${prestigeCls || `font-bold ${colors.text}`}`}>
          {colors.icon} {tContent(`${entry.templateId}.name`)}
          {entry.refineLevel > 0 && (
            <span className={prestigeCls || "text-emerald-400"}>
              {" "}
              {tInv("refinePlus", { level: entry.refineLevel })}
            </span>
          )}
        </span>
        {countdown.unit !== "expired" && (
          <span className="truncate text-[10px] text-ddp-ink-muted">
            {t(`buybackCountdown.${countdown.unit}`, countdown.params)}
          </span>
        )}
      </div>
      <span
        className={`flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums ${
          canAfford ? "text-ddp-gold-bright" : "text-rose-400"
        }`}
      >
        <Coin />
        {entry.price}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => guard.trigger(true, () => onBuy(entry))}
        aria-label={t("buybackAria", { name: tContent(`${entry.templateId}.name`), price: entry.price })}
        className={`min-h-11 shrink-0 rounded-(--ddp-radius-md) border px-2.5 text-xs font-bold transition-all active:scale-95 ${
          disabled
            ? "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted/50"
            : "border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:brightness-110"
        }`}
      >
        {guard.confirming ? t("buybackConfirm") : t("buybackButton")}
      </button>
    </div>
  );
}

/** The buy-back tab body — fetches from the server on mount (tab open) and
 * refetches after every buy-back attempt (success shrinks the list; a
 * failure like "expired" may have too). Loading/error/empty are distinct
 * states (per spec): `entries === null` is "still loading", `loadError` is
 * "the fetch itself failed" (retry tap), otherwise an empty filtered list is
 * the genuine "nothing to buy back" state. */
function BuybackTab() {
  const t = useTranslations("shop");
  const [entries, setEntries] = useState<BuybackListEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const list = await fetchBuybackList();
    if (list === null) {
      setLoadError(true);
      setEntries([]);
    } else {
      setLoadError(false);
      setEntries(list);
    }
  }, []);

  useEffect(() => {
    // Same "fetch once on mount" shape as `CharactersScreen.tsx`'s roster
    // load (see its doc) — `load` eventually calls `setEntries` after its
    // `await`, which the `set-state-in-effect` rule flags, but there's no
    // reactive dependency to resync on: this effect only re-runs when the
    // tab (re)mounts, i.e. exactly once per tab-open.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot tab-open fetch, see above
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), COUNTDOWN_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  async function handleBuy(entry: BuybackListEntry): Promise<void> {
    setBusyId(entry.soldItemId);
    await executeBuyback(entry.soldItemId);
    await load();
    setBusyId(null);
  }

  const visible = useMemo(
    () => (entries ?? []).filter((e) => formatBuybackCountdown(e.expiresAt, now).unit !== "expired"),
    [entries, now],
  );

  if (entries === null) {
    return <p className="text-[11px] text-ddp-ink-muted/70">{t("buybackLoading")}</p>;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <p className="text-[11px] text-rose-300">{t("buybackLoadError")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 text-xs font-bold text-ddp-ink-muted"
        >
          {t("buybackRetryButton")}
        </button>
      </div>
    );
  }

  if (visible.length === 0) {
    return <p className="text-[11px] text-ddp-ink-muted/70">{t("buybackEmptyHint")}</p>;
  }

  return (
    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
      {visible.map((entry) => (
        <BuybackRow
          key={entry.soldItemId}
          entry={entry}
          now={now}
          busy={busyId === entry.soldItemId}
          onBuy={handleBuy}
        />
      ))}
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
  const [activeTab, setActiveTab] = useState<"buy" | "sell" | "buyback">("buy");

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
            <button
              type="button"
              onClick={() => setActiveTab("buyback")}
              aria-pressed={activeTab === "buyback"}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-colors ${
                activeTab === "buyback"
                  ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
                  : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
              }`}
            >
              {t("tabBuyback")}
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
          ) : activeTab === "sell" ? (
            <SellTab />
          ) : (
            <BuybackTab />
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
