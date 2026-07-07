"use client";

/**
 * M7.5→M7.9 Fast Travel — the zone-picker modal. Same modal shell convention as
 * `InventoryPanel.tsx`/`SettingsPanel.tsx` (fixed overlay, sim never pauses
 * behind it). Single menu stays THE way to warp anywhere including town (owner:
 * no separate town button) — town is pinned as a prominent full-width row at
 * the very top, then every other map gets its own themed SECTION (`MAP_THEME`
 * below, colors anchored to `render/environment/biomes.ts`'s per-map ground
 * tones — reimplemented here as plain Tailwind/CSS, this component never
 * imports `@/render`). Lists every UNLOCKED, non-boss zone (`ui/world/zones.ts`'s
 * `fastTravelTargets`); tapping a zone queues the `fastTravel` intent, the
 * engine does the real validation (aggro/locked/mid-transit/…) and rejects with
 * a `fastTravelBlocked` reason (surfaced as a `NoticeToast`, see
 * `GameClient.tsx`) — this picker's own disabled states are a best-effort UX
 * guard, not the source of truth.
 */

import { useTranslations } from "next-intl";
import {
  fastTravelTargets,
  isZoneUnlockedUi,
  zonesGroupedByMap,
  type UiZone,
} from "@/ui/world/zones";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { useGameStore } from "@/ui/store/gameStore";

const ALL_TARGETS = fastTravelTargets();
const TOWN_ZONE: UiZone | null = ALL_TARGETS.find((z) => z.kind === "town") ?? null;
const FARM_ZONES_BY_MAP = zonesGroupedByMap(ALL_TARGETS.filter((z) => z.kind !== "town"));

/** Per-map themed row/header classes (owner: "ล้อกับธีมแมพ") — anchored to
 * `render/environment/biomes.ts`'s ground tones / `render/theme.ts`'s
 * `BOSS_COLORS`, but hand-picked Tailwind utility colors (no `@/render` import
 * from `ui/`). Emoji are pre-2020 Unicode only (footgun #4 — no Windows 10
 * tofu). */
interface MapTheme {
  emoji: string;
  header: string;
  row: string;
}

const MAP_THEME: Record<string, MapTheme> = {
  // map1 — โลกมนุษย์: forest greens.
  map1: {
    emoji: "🌲",
    header: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    row: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20",
  },
  // map2 — แดนอสูร: demonic crimson.
  map2: {
    emoji: "👹",
    header: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    row: "border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
  },
  // map3 — พรมแดนเถื่อน: frontier bronze.
  map3: {
    emoji: "⚔️",
    header: "border-amber-600/40 bg-amber-700/10 text-amber-200",
    row: "border-amber-600/30 bg-amber-700/10 text-amber-100 hover:bg-amber-700/20",
  },
  // map4 — ทุนดราน้ำแข็ง: ice blues.
  map4: {
    emoji: "❄️",
    header: "border-sky-400/40 bg-sky-400/10 text-sky-200",
    row: "border-sky-400/30 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20",
  },
  // map5 — ทะเลทรายซากอารยธรรม: desert gold.
  map5: {
    emoji: "🏺",
    header: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
    row: "border-yellow-500/30 bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20",
  },
  // map6 — นครนรก: infernal near-black + ember.
  map6: {
    emoji: "🔥",
    header: "border-orange-700/50 bg-black/40 text-orange-300",
    row: "border-orange-700/40 bg-black/30 text-orange-200 hover:bg-black/50",
  },
};

const FALLBACK_THEME: MapTheme = MAP_THEME.map1;

function themeFor(mapId: string): MapTheme {
  return MAP_THEME[mapId] ?? FALLBACK_THEME;
}

function stageRangeOf(zones: readonly UiZone[]): { min: number; max: number } {
  const stages = zones.filter((z) => z.kind === "farm").map((z) => z.stage);
  return { min: Math.min(...stages), max: Math.max(...stages) };
}

export interface FastTravelPickerProps {
  onClose: () => void;
}

function ZoneRow({
  zone,
  theme,
  prominent,
  onSelect,
}: {
  zone: UiZone;
  theme: MapTheme;
  /** Town's own row gets bigger, gold-accented styling on top of its theme. */
  prominent?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("world");
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const world = useGameStore((s) => s.world);
  const queueFastTravel = useGameStore((s) => s.queueFastTravel);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);

  const unlocked = isZoneUnlockedUi(zone, unlockedZones);
  const isCurrent = world.mapId === zone.mapId && world.zoneIdx === zone.zoneIdx;
  const enabled = unlocked && !isCurrent && !channeling && !world.traveling;

  const label =
    zone.kind === "town" ? t("zoneTown") : t("zoneFarm", { stage: zone.stage });

  const rowClass = !unlocked
    ? "cursor-not-allowed border-ddp-border bg-black/25 text-ddp-ink-muted"
    : isCurrent
      ? `${theme.row} ring-2 ring-ddp-gold-bright cursor-default`
      : channeling || world.traveling
        ? "cursor-not-allowed border-ddp-border bg-black/25 text-ddp-ink-muted"
        : theme.row;

  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => {
        if (!enabled) return;
        queueFastTravel({ mapId: zone.mapId, zoneIdx: zone.zoneIdx });
        // Close the picker on select so the channel bar / warp is visible
        // immediately (owner request 2026-07-07) — engine-side rejects still
        // surface via the fastTravelBlocked NoticeToast.
        onSelect();
      }}
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-(--ddp-radius-md) border px-3 py-2 text-left font-bold transition-colors active:scale-[0.98] ${
        prominent ? "text-sm" : "text-xs"
      } ${rowClass}`}
    >
      <span className="flex items-center gap-1.5">
        {zone.kind === "town" && (
          <span aria-hidden className={prominent ? "text-lg" : undefined}>
            🏠
          </span>
        )}
        {label}
      </span>
      {isCurrent ? (
        <span className="text-[10px] uppercase">{t("fastTravelCurrent")}</span>
      ) : !unlocked ? (
        <span aria-hidden>🔒</span>
      ) : null}
    </button>
  );
}

function MapSection({
  mapId,
  zones,
  onSelect,
}: {
  mapId: string;
  zones: UiZone[];
  onSelect: () => void;
}) {
  const tMaps = useTranslations("content.maps");
  const t = useTranslations("world");
  const theme = themeFor(mapId);
  const { min, max } = stageRangeOf(zones);

  return (
    <section className="flex flex-col gap-1.5">
      <div
        className={`flex items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-extrabold tracking-wide ${theme.header}`}
      >
        <span aria-hidden>{theme.emoji}</span>
        <span className="truncate">{tMaps(`${mapId}.name`)}</span>
        <span className="ml-auto shrink-0 font-semibold opacity-80">
          {t("fastTravelStageRange", { min, max })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {zones.map((zone) => (
          <ZoneRow
            key={`${zone.mapId}-${zone.zoneIdx}`}
            zone={zone}
            theme={theme}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export function FastTravelPicker({ onClose }: FastTravelPickerProps) {
  const t = useTranslations("world");

  return (
    <ModalPortal>
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
          {TOWN_ZONE && (
            <ZoneRow
              zone={TOWN_ZONE}
              theme={themeFor(TOWN_ZONE.mapId)}
              prominent
              onSelect={onClose}
            />
          )}

          {FARM_ZONES_BY_MAP.map((group) => (
            <MapSection
              key={group.mapId}
              mapId={group.mapId}
              zones={group.zones}
              onSelect={onClose}
            />
          ))}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
