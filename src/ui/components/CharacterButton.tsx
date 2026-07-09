"use client";

/**
 * R2-W2 "fullscreen HUD" — icon-tile trigger for the NEW `CharacterPanel`
 * (stat points + equipped loadout + switch-character link, moved off the old
 * in-flow "settings row" — see `GameHud.tsx`'s doc + `CharacterPanel.tsx`).
 * Same local `useState` open/close idiom as every other icon-menu-row
 * trigger.
 *
 * Carries `data-onboarding-anchor="character-menu"` — the FTUE's
 * `allocateStats` step used to spotlight `StatPanel`'s own inline
 * `stat-panel` anchor directly; now that the stat panel only exists inside
 * this modal, the step re-anchors to THIS always-visible trigger instead
 * (`src/ui/onboarding/steps.ts`).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CharacterIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { CharacterPanel } from "@/ui/components/CharacterPanel";

export function CharacterButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("hud");

  return (
    <>
      <div data-onboarding-anchor="character-menu">
        <IconTileButton
          icon={<CharacterIcon className="h-5 w-5" />}
          onClick={() => setOpen(true)}
          aria-label={t("characterMenuAria")}
          title={t("characterMenuAria")}
        />
      </div>
      {open && <CharacterPanel onClose={() => setOpen(false)} />}
    </>
  );
}
