"use client";

/**
 * R2-W2 "fullscreen HUD" — icon-tile trigger for `FastTravelPicker`,
 * relocated off the old `HudBar.tsx` (that component dissolved — see
 * `GameHud.tsx`'s doc). "Warp = ONE place, no satellites" house rule
 * unchanged — this is a MOVE of the same 🌀 button, not a duplicate.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FastTravelPicker } from "@/ui/components/FastTravelPicker";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { useGameStore } from "@/ui/store/gameStore";

export function WarpButton() {
  const worldTraveling = useGameStore((s) => s.world.traveling);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const [open, setOpen] = useState(false);
  const t = useTranslations("world");

  return (
    <>
      <IconTileButton
        icon={<span aria-hidden>🌀</span>}
        accent="sky"
        disabled={worldTraveling || channeling}
        onClick={() => setOpen(true)}
        aria-label={t("fastTravelButton")}
        title={t("fastTravelButton")}
      />
      {open && <FastTravelPicker onClose={() => setOpen(false)} />}
    </>
  );
}
