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
 *
 * Cooldown visual (owner ask, 2026-07-09): while `shop.ready[item]` is false because
 * of the per-type use-cooldown (`shop.cds[item] > 0`), the button reuses SkillBar's
 * EXACT sweep technique — a linear-`height` CSS animation whose duration is the
 * potion's full cooldown (`shop.maxCds[item]`) and whose `animation-delay` is
 * negative by the already-elapsed amount, so it resumes at the right point from a
 * single throttled snapshot value, plus a top-left seconds-remaining badge. It
 * only restarts (remounts via `key`) on a fresh use, via the same `useCastKey` hook.
 *
 * R2-W2 reskin: squared up into mockup-style quick-slot tiles (was a plain
 * round icon button) — bigger tap target, gold "×N" qty pill top-right
 * mirroring `ItemTile`'s own qty-badge convention (a full `ItemTile` doesn't
 * fit here: potions have no rarity/tier to frame). Behavior/handlers
 * untouched.
 */

import { useTranslations } from "next-intl";
import { useCastKey } from "@/ui/hooks/useCastKey";
import { useGameStore } from "@/ui/store/gameStore";

function PotionButton({ item, icon }: { item: "hpPotion" | "manaPotion"; icon: string }) {
  const count = useGameStore((s) => s.shop.counts[item]);
  const ready = useGameStore((s) => s.shop.ready[item]);
  const cd = useGameStore((s) => s.shop.cds[item]);
  const maxCd = useGameStore((s) => s.shop.maxCds[item]);
  const use = useGameStore((s) => s.useConsumable);
  const tContent = useTranslations("content.items");
  const t = useTranslations("shop");
  const name = tContent(`${item}.name`);
  const castKey = useCastKey(cd);
  const cdSeconds = Math.ceil(cd);
  const delay = -(maxCd - cd);

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => use(item)}
      aria-label={t("useAria", { name, count })}
      title={name}
      className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border-2 text-xl shadow-(--ddp-shadow-btn) transition-all active:scale-95 ${
        ready
          ? "border-ddp-border-soft bg-ddp-panel-strong hover:brightness-110"
          : "cursor-not-allowed border-ddp-border bg-black/30"
      }`}
    >
      <span
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] ${
          !ready ? "grayscale" : ""
        }`}
      >
        <span aria-hidden>{icon}</span>
        {cd > 0 && (
          <span
            key={castKey}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 [animation-name:ddp-cooldown-sweep] [animation-timing-function:linear] [animation-fill-mode:forwards]"
            style={{
              animationDuration: `${maxCd}s`,
              animationDelay: `${delay}s`,
            }}
          />
        )}
        {cd > 0 && (
          <span className="pointer-events-none absolute top-0.5 left-0.5 rounded-full bg-black/60 px-1 text-[10px] font-bold text-ddp-ink tabular-nums">
            {cdSeconds}
          </span>
        )}
      </span>
      {/* Qty pill — gold, top-right, mirrors `ItemTile`'s "×N" convention. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 right-0.5 min-w-4 rounded-full bg-ddp-gold px-1 text-[9px] leading-none font-black tabular-nums text-[#241705]"
      >
        ×{count}
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
        className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border-2 text-xl shadow-(--ddp-shadow-btn) transition-all active:scale-95 ${
          scrollEnabled
            ? "border-ddp-boss/60 bg-ddp-panel-strong hover:brightness-110"
            : "cursor-not-allowed border-ddp-border bg-black/30 grayscale"
        }`}
      >
        <span aria-hidden>📜</span>
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 right-0.5 min-w-4 rounded-full bg-ddp-gold px-1 text-[9px] leading-none font-black tabular-nums text-[#241705]"
        >
          ×{scrollCount}
        </span>
      </button>
    </div>
  );
}
