"use client";

/**
 * Settings-drawer trigger for the settings row (M6 settings-panel task) —
 * same local-`useState` open/close pattern as `CodexButton.tsx` (purely a UI
 * concern; the sim keeps running behind the drawer).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SettingsIcon } from "@/ui/components/icons";
import { IconTileButton } from "@/ui/components/primitives/IconTileButton";
import { SettingsPanel } from "@/ui/components/SettingsPanel";
import { onOpenAccountSettingsRequest } from "@/ui/openSettingsSignal";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("settings");

  // Friends panel's guest-state CTA ("go to My Account") asks this drawer to
  // open itself — see `openSettingsSignal.ts`'s doc.
  useEffect(() => onOpenAccountSettingsRequest(() => setOpen(true)), []);

  return (
    <>
      <IconTileButton
        icon={<SettingsIcon className="h-5 w-5" />}
        onClick={() => setOpen(true)}
        aria-label={t("openButton")}
        title={t("openButton")}
      />
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
