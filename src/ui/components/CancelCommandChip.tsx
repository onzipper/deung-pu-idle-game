"use client";

/**
 * Manual play (M7.8) cancel affordance — appears ONLY while the solo hero has
 * an active move/attack command (`HeroSummary.hasCommand`, a read-only mirror
 * of the engine's `hero.command`). Tapping the ground while a command is
 * active just issues a new `moveTo` (the engine replaces the command — no
 * special UI for that case); this chip is for the "stop entirely, go back to
 * AUTO/idle" case. Lives next to `BotMasterSwitch` (same combat-control tier,
 * not a buried preference) — same chip styling/sizing convention (≥44px
 * touch target), so it reads as part of the same control cluster.
 */

import { useTranslations } from "next-intl";

import { useGameStore } from "@/ui/store/gameStore";

export function CancelCommandChip() {
  const hasCommand = useGameStore((s) => s.heroes[0]?.hasCommand ?? false);
  const queueCancelCommand = useGameStore((s) => s.queueCancelCommand);
  const t = useTranslations("hud");

  if (!hasCommand) return null;

  return (
    <button
      type="button"
      onClick={() => queueCancelCommand()}
      aria-label={t("cancelCommandAria")}
      className="flex min-h-11 items-center justify-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-3 py-2 text-xs font-extrabold tracking-wide text-ddp-ink transition-all duration-100 hover:brightness-125 active:translate-y-0.5 active:scale-[0.97]"
    >
      {t("cancelCommandButton")}
    </button>
  );
}
