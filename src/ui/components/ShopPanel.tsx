"use client";

/**
 * NPC shop panel (M6 "เมืองหลัก + NPC shops") — rendered ONLY while the hero is in
 * the town zone (the NPC is there — GDD). Simple buy rows: icon + name, the
 * stage-scaled price, the owned/cap count, and +1 / +5 buy buttons. The buy queues
 * a `buyShopItem` intent (drained once per frame by GameClient); the engine no-ops
 * an unaffordable / over-cap purchase, so the buttons just grey out to match.
 *
 * Icons are pre-2015 emoji (❤ / 💧 / 📜) so Windows 10 renders them (no Unicode-13+
 * glyphs — see CLAUDE.md footgun #4).
 */

import { useTranslations } from "next-intl";
import type { ShopItemId } from "@/engine";
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
        <span className="truncate text-xs font-bold text-ddp-ink">
          {tContent(`${item}.name`)}
        </span>
        <span className="text-[10px] text-ddp-ink-muted">{tContent(`${item}.desc`)}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="flex items-center gap-1 text-[11px] font-bold tabular-nums text-ddp-gold-bright">
          <Coin />
          {price}
        </span>
        <span
          className={`text-[10px] tabular-nums ${atCap ? "text-emerald-400" : "text-ddp-ink-muted"}`}
        >
          {t("owned", { count, cap: shop.stackCap })}
        </span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={!canBuyOne}
          onClick={() => buy(item, 1)}
          aria-label={t("buyAria", { name: tContent(`${item}.name`), qty: 1 })}
          className={`min-h-9 min-w-9 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-all active:scale-95 ${
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
          className={`min-h-9 min-w-9 rounded-(--ddp-radius-md) border px-2 text-xs font-bold transition-all active:scale-95 ${
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

export function ShopPanel() {
  const inTown = useGameStore((s) => s.world.kind === "town");
  const t = useTranslations("shop");

  if (!inTown) return null;

  return (
    <div className="flex flex-col gap-2 rounded-(--ddp-radius-lg) border border-ddp-gold/40 bg-ddp-panel px-3 py-2.5 shadow-(--ddp-shadow-panel) backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-sm">
          🏠
        </span>
        <span className="text-xs font-bold tracking-wide text-ddp-gold-bright">
          {t("title")}
        </span>
        <span className="text-[10px] text-ddp-ink-muted">{t("subtitle")}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {SHOP_ORDER.map((item) => (
          <BuyRow key={item} item={item} />
        ))}
      </div>
    </div>
  );
}
