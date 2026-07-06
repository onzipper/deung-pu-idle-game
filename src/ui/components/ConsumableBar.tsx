"use client";

/**
 * Potion quick-use bar (M6 "เมืองหลัก") — sits next to the mana bar in the console
 * dock. Two potion buttons (❤ HP / 💧 mana) with live counts + a return-scroll
 * (📜) button. Tapping queues a `useConsumable` / `useReturnScroll` intent (drained
 * once per frame by GameClient — a tap uses exactly one at any speed).
 *
 * Enabled state comes straight from the engine's precomputed guards (`shop.ready`,
 * a live/in-stock/off-cooldown/not-full check); the scroll is disabled at 0 held or
 * while already in town. Icons are pre-2015 emoji (Win10-safe — footgun #4).
 */

import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";

function PotionButton({ item, icon }: { item: "hpPotion" | "manaPotion"; icon: string }) {
  const count = useGameStore((s) => s.shop.counts[item]);
  const ready = useGameStore((s) => s.shop.ready[item]);
  const use = useGameStore((s) => s.useConsumable);
  const tContent = useTranslations("content.items");
  const t = useTranslations("shop");
  const name = tContent(`${item}.name`);

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => use(item)}
      aria-label={t("useAria", { name, count })}
      title={name}
      className={`relative flex min-h-11 min-w-11 items-center justify-center rounded-(--ddp-radius-md) border text-lg shadow-(--ddp-shadow-btn) transition-all active:scale-95 ${
        ready
          ? "border-ddp-border-soft bg-ddp-panel-strong hover:brightness-110"
          : "cursor-not-allowed border-ddp-border bg-black/30 grayscale"
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="absolute -right-1 -bottom-1 min-w-4 rounded-full bg-black/80 px-1 text-[10px] font-bold tabular-nums text-ddp-ink">
        {count}
      </span>
    </button>
  );
}

export function ConsumableBar() {
  const scrollCount = useGameStore((s) => s.shop.counts.returnScroll);
  const inTown = useGameStore((s) => s.world.kind === "town");
  // Aliased off `use*` so it isn't linted as a React hook (rules-of-hooks).
  const teleportToTown = useGameStore((s) => s.useReturnScroll);
  const t = useTranslations("shop");

  const scrollEnabled = scrollCount > 0 && !inTown;

  return (
    <div className="flex items-center gap-1.5" data-onboarding-anchor="consumables">
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("quickUseLabel")}
      </span>
      <PotionButton item="hpPotion" icon="❤" />
      <PotionButton item="manaPotion" icon="💧" />
      <button
        type="button"
        disabled={!scrollEnabled}
        onClick={() => teleportToTown()}
        aria-label={t("returnScrollAria", { count: scrollCount })}
        title={inTown ? t("returnScrollInTown") : t("returnScrollTitle")}
        className={`relative flex min-h-11 min-w-11 items-center justify-center rounded-(--ddp-radius-md) border text-lg shadow-(--ddp-shadow-btn) transition-all active:scale-95 ${
          scrollEnabled
            ? "border-ddp-boss/60 bg-ddp-panel-strong hover:brightness-110"
            : "cursor-not-allowed border-ddp-border bg-black/30 grayscale"
        }`}
      >
        <span aria-hidden>📜</span>
        <span className="absolute -right-1 -bottom-1 min-w-4 rounded-full bg-black/80 px-1 text-[10px] font-bold tabular-nums text-ddp-ink">
          {scrollCount}
        </span>
      </button>
    </div>
  );
}
