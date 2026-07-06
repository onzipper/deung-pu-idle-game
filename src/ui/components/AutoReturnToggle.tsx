"use client";

/**
 * Death-behaviour toggle (M6 "World & Town"): "auto กลับไปฟาร์ม" (auto-walk back
 * to the last farmed zone after respawning in town) vs "รอที่เมือง" (wait in
 * town). UI-owned like `autoCast` — GameClient mirrors it onto `state.autoReturn`
 * each frame. Minimal for M6; the settings UI task expands this.
 */

import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";

export function AutoReturnToggle() {
  const autoReturn = useGameStore((s) => s.autoReturn);
  const toggle = useGameStore((s) => s.toggleAutoReturn);
  const t = useTranslations("world");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={autoReturn}
      className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-semibold transition-colors ${
        autoReturn
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
          : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
      }`}
    >
      {autoReturn ? t("autoReturnOn") : t("autoReturnOff")}
    </button>
  );
}

/** Auto next-zone toggle (2026-07-07): quota met -> walk into the next
 * unlocked FARM zone automatically (never auto-enters a boss room). Same
 * UI-owned mirror pattern as `AutoReturnToggle` above. */
export function AutoAdvanceToggle() {
  const autoAdvance = useGameStore((s) => s.autoAdvance);
  const toggle = useGameStore((s) => s.toggleAutoAdvance);
  const t = useTranslations("world");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={autoAdvance}
      className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-semibold transition-colors ${
        autoAdvance
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
          : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
      }`}
    >
      {autoAdvance ? t("autoAdvanceOn") : t("autoAdvanceOff")}
    </button>
  );
}
