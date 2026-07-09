"use client";

/**
 * R2-W2 "fullscreen HUD" — the gold + refine-material readout row, relocated
 * off the old `HudBar.tsx` (that component dissolved — see `GameHud.tsx`'s
 * doc) into the top-right overlay column. Same `CurrencyChip` primitive, same
 * gold-first > violet-secondary hierarchy, same container-only pulse — a MOVE,
 * not a redesign.
 */

import { useTranslations } from "next-intl";
import { Coin, MaterialIcon } from "@/ui/components/icons";
import { CurrencyChip } from "@/ui/components/primitives/CurrencyChip";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { useGameStore } from "@/ui/store/gameStore";

export function CurrencyChipsRow() {
  const gold = useGameStore((s) => s.gold);
  const materials = useGameStore((s) => s.materials);
  const t = useTranslations("hud");

  const goldPulse = usePulseOnIncrease(gold);
  const materialsPulse = usePulseOnIncrease(materials);

  return (
    <div className="flex items-center gap-1.5">
      <CurrencyChip
        icon={<Coin className="h-5 w-5" />}
        value={gold}
        pulse={goldPulse}
        variant="gold"
        ariaLabel={t("goldAria")}
      />
      <CurrencyChip
        icon={<MaterialIcon className="h-4 w-4" />}
        value={materials}
        pulse={materialsPulse}
        variant="violet"
        ariaLabel={t("materialsAria")}
      />
    </div>
  );
}
