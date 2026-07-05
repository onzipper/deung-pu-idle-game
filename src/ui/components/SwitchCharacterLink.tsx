"use client";

/**
 * Small "สลับตัวละคร" link for the settings row (M5 Character Pivot) —
 * navigates to `/characters` (roster + creation, see
 * `src/ui/components/characters/CharactersScreen.tsx`). Plain navigation
 * (not a store mutation), so this never touches `GameClient`'s rAF loop /
 * engine state — matches `CodexButton`'s sizing/shape for visual consistency
 * in the row, but is a real link (not a modal trigger).
 */

import { useTranslations } from "next-intl";
import Link from "next/link";

export function SwitchCharacterLink() {
  const t = useTranslations("characters");

  return (
    <Link
      href="/characters"
      className="flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 text-xs font-bold text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-[0.95]"
    >
      {t("hudLink")}
    </Link>
  );
}
