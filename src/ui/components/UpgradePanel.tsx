"use client";

/**
 * Three independent upgrade lines (atk / speed / hp) + an auto-buy toggle.
 * Buying is an intent — `buyUpgrade(stat)` only queues it; the integration
 * loop drains it into `FrameInput.buyUpgrade` for the engine to apply.
 *
 * Button states (task 86d3k2tap): affordable gets an inviting emerald glow,
 * un-affordable is visibly "locked" (grayscale + a corner lock badge, not
 * just dimmed opacity), capped shows a distinct MAX state.
 */

import { useTranslations } from "next-intl";
import { SPEED_UPGRADE_CAP, type Upgrades } from "@/engine";
import { usePulseOnIncrease } from "@/ui/hooks/usePulseOnIncrease";
import { UPGRADE_ICONS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const STATS: (keyof Upgrades)[] = ["atk", "speed", "hp"];

function UpgradeButton({ stat }: { stat: keyof Upgrades }) {
  const level = useGameStore((s) => s.upgrades[stat]);
  const cost = useGameStore((s) => s.upgradeCosts[stat]);
  const gold = useGameStore((s) => s.gold);
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const boughtPulse = usePulseOnIncrease(level, 300);
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");
  const tCommon = useTranslations("common");

  const capped = stat === "speed" && level >= SPEED_UPGRADE_CAP;
  const affordable = gold >= cost && !capped;
  const locked = !affordable && !capped;
  const name = tContent(`upgrades.${stat}.name`);
  const icon = UPGRADE_ICONS[stat];

  return (
    <button
      type="button"
      disabled={!affordable}
      onClick={() => buyUpgrade(stat)}
      aria-label={tPanels("upgradeAriaLabel", {
        name,
        level,
        costState: capped ? "capped" : "normal",
        cost: cost.toLocaleString(),
      })}
      className={`relative flex min-h-11 min-w-24 flex-1 flex-col items-center gap-0.5 rounded-(--ddp-radius-md) border px-3 py-2.5 shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
        affordable
          ? "border-emerald-400/60 bg-ddp-panel-strong text-ddp-ink before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_16px_3px_rgba(52,211,153,0.5)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.6s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110"
          : capped
            ? "cursor-default border-ddp-boss/50 bg-ddp-panel-strong text-ddp-ink"
            : "cursor-not-allowed border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted grayscale"
      } ${boughtPulse ? "animate-buy-pulse" : ""}`}
    >
      {locked && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-ddp-border bg-black/80 text-[9px]"
        >
          🔒
        </span>
      )}
      <span className="text-xs font-bold">
        {icon} {name}
      </span>
      <span className="text-[10px] text-ddp-ink-muted">{tCommon("levelBadge", { level })}</span>
      <span className="text-[11px] font-bold text-ddp-gold tabular-nums">
        {capped ? tCommon("maxLabel") : cost.toLocaleString()}
      </span>
    </button>
  );
}

export function UpgradePanel() {
  const autoUpgrade = useGameStore((s) => s.autoUpgrade);
  const toggleAutoUpgrade = useGameStore((s) => s.toggleAutoUpgrade);
  const t = useTranslations("panels");

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("upgradesLabel")}
      </span>
      <div className="flex flex-wrap items-stretch gap-2">
        {STATS.map((stat) => (
          <UpgradeButton key={stat} stat={stat} />
        ))}
        <button
          type="button"
          onClick={toggleAutoUpgrade}
          aria-pressed={autoUpgrade}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
            autoUpgrade
              ? "border-emerald-400 bg-emerald-400 text-emerald-950"
              : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${autoUpgrade ? "bg-emerald-950" : "bg-ddp-ink-muted"}`}
          />
          {t("autoUpgradeToggle", { state: autoUpgrade ? "on" : "off" })}
        </button>
      </div>
    </div>
  );
}
