"use client";

/**
 * Ghost-presence "show other players in the world" toggle (ghost-presence Wave 2).
 * `ghostsVisible` is a plain UI-owned store field (localStorage-persisted, NOT SaveData
 * — same tier as `soundMuted`); `GameClient`'s loop reads it to lazily open/close the
 * world socket and clear ghosts. This row only flips the store flag. Default ON.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { readStoredGhostsVisible, useGameStore } from "@/ui/store/gameStore";

export function GhostToggle() {
  const ghostsVisible = useGameStore((s) => s.ghostsVisible);
  const toggleGhostsVisible = useGameStore((s) => s.toggleGhostsVisible);
  const setGhostsVisible = useGameStore((s) => s.setGhostsVisible);
  const t = useTranslations("settings");

  // Apply the persisted preference once, AFTER hydration (reading localStorage during the
  // initial render would desync SSR/first-client render — see gameStore.ts / SoundToggle).
  useEffect(() => {
    setGhostsVisible(readStoredGhostsVisible());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-ddp-ink">{t("showGhosts")}</span>
      <button
        type="button"
        role="switch"
        onClick={toggleGhostsVisible}
        aria-checked={ghostsVisible}
        aria-label={t("showGhosts")}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-(--ddp-radius-md) border px-3 text-lg shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] ${
          ghostsVisible
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
        }`}
      >
        {ghostsVisible ? "👥" : "🚶"}
      </button>
    </label>
  );
}
