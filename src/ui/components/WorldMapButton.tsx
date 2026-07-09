"use client";

/**
 * R2-W2 "fullscreen HUD" — icon-tile trigger for `WorldMapPanel`, relocated
 * off the old `HudBar.tsx`'s tappable zone-chip (that component dissolved —
 * see `GameHud.tsx`'s doc). Same local `useState` open/close idiom as every
 * other icon-menu-row trigger. The zone/stage LABEL itself (what `HudBar`'s
 * chip used to also show inline) is dropped here — W3's minimap card is the
 * next place a live zone readout belongs; this button is purely the map
 * panel's entry point now.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MapIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { WorldMapPanel } from "@/ui/world/WorldMapPanel";

export function WorldMapButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("worldMap");

  return (
    <>
      <IconTileButton
        icon={<MapIcon className="h-5 w-5" />}
        onClick={() => setOpen(true)}
        aria-label={t("entryAria")}
        title={t("entryAria")}
      />
      {open && <WorldMapPanel onClose={() => setOpen(false)} />}
    </>
  );
}
