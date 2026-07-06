"use client";

/**
 * HUD AUTO button (M7.5) — toggles the engine's auto-hunt (SAVE v12,
 * engine-persisted; see `GameState.autoHunt`). Lives next to the walk controls
 * because it's a moment-to-moment combat control, not a buried preference:
 * OFF = the hero stops acquiring NEW targets (still finishes off attackers
 * already engaged on it; boss fights ignore the toggle by design).
 *
 * Reads the current value from the throttled snapshot and queues the
 * `setAutoHunt` intent — never shadow-owns the flag (same rule as the bot
 * settings section). Icon is a pre-2015 emoji (Win10-safe — footgun #4).
 */

import { useTranslations } from "next-intl";

import { useGameStore } from "@/ui/store/gameStore";

export function AutoHuntToggle() {
  const autoHunt = useGameStore((s) => s.autoHunt);
  const queueSetAutoHunt = useGameStore((s) => s.queueSetAutoHunt);
  const t = useTranslations("hud");

  return (
    <button
      type="button"
      onClick={() => queueSetAutoHunt(!autoHunt)}
      aria-pressed={autoHunt}
      aria-label={autoHunt ? t("autoHuntAriaOn") : t("autoHuntAriaOff")}
      className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-extrabold tracking-wide transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
        autoHunt
          ? "border-emerald-400/70 bg-emerald-950/60 text-emerald-300 shadow-(--ddp-shadow-btn)"
          : "border-ddp-border bg-black/30 text-ddp-ink-muted grayscale"
      }`}
    >
      ⚔ {autoHunt ? t("autoHuntOn") : t("autoHuntOff")}
    </button>
  );
}
