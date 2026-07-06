"use client";

/**
 * M7.5 Fast Travel — the zone-picker modal. Same modal shell convention as
 * `InventoryPanel.tsx`/`SettingsPanel.tsx` (fixed overlay, sim never pauses
 * behind it). Lists every UNLOCKED, non-boss zone (`ui/world/zones.ts`'s
 * `fastTravelTargets`), grouped by map, town flagged. Tapping a zone queues
 * the `fastTravel` intent; the engine does the real validation (aggro/locked/
 * mid-transit/…) and rejects with a `fastTravelBlocked` reason (surfaced as a
 * `NoticeToast`, see `GameClient.tsx`) — this picker's own disabled states are
 * a best-effort UX guard, not the source of truth.
 */

import { useTranslations } from "next-intl";
import {
  fastTravelTargets,
  isZoneUnlockedUi,
  zonesGroupedByMap,
  type UiZone,
} from "@/ui/world/zones";
import { useGameStore } from "@/ui/store/gameStore";

const ZONES_BY_MAP = zonesGroupedByMap(fastTravelTargets());

export interface FastTravelPickerProps {
  onClose: () => void;
}

function ZoneRow({ zone }: { zone: UiZone }) {
  const t = useTranslations("world");
  const tMaps = useTranslations("content.maps");
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const world = useGameStore((s) => s.world);
  const queueFastTravel = useGameStore((s) => s.queueFastTravel);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);

  const unlocked = isZoneUnlockedUi(zone, unlockedZones);
  const isCurrent = world.mapId === zone.mapId && world.zoneIdx === zone.zoneIdx;
  const enabled = unlocked && !isCurrent && !channeling && !world.traveling;

  const label =
    zone.kind === "town" ? t("zoneTown") : t("zoneFarm", { stage: zone.stage });

  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={() =>
        enabled && queueFastTravel({ mapId: zone.mapId, zoneIdx: zone.zoneIdx })
      }
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-(--ddp-radius-md) border px-3 py-2 text-left text-xs font-bold transition-colors ${
        enabled
          ? "border-sky-400/50 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 active:scale-[0.98]"
          : "cursor-not-allowed border-ddp-border bg-black/25 text-ddp-ink-muted"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {zone.kind === "town" && <span aria-hidden>🏠</span>}
        {tMaps(`${zone.mapId}.name`)} — {label}
      </span>
      {isCurrent ? (
        <span className="text-[10px] uppercase">{t("fastTravelCurrent")}</span>
      ) : !unlocked ? (
        <span aria-hidden>🔒</span>
      ) : null}
    </button>
  );
}

export function FastTravelPicker({ onClose }: FastTravelPickerProps) {
  const t = useTranslations("world");

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("fastTravelTitle")}
    >
      <button
        type="button"
        aria-label={t("fastTravelClose")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-ddp-gold-bright">
            🌀 {t("fastTravelTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
          >
            ✕ {t("fastTravelClose")}
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {ZONES_BY_MAP.map((group) => (
            <section key={group.mapId} className="flex flex-col gap-1.5">
              {group.zones.map((zone) => (
                <ZoneRow key={`${zone.mapId}-${zone.zoneIdx}`} zone={zone} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
