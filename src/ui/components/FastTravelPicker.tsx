"use client";

/**
 * M7.5→M7.9 Fast Travel — the zone-picker modal. Same modal shell convention as
 * `InventoryPanel.tsx`/`SettingsPanel.tsx` (fixed overlay, sim never pauses
 * behind it). Single menu stays THE way to warp anywhere including town (owner:
 * no separate town button) — town is pinned as a prominent full-width row at
 * the very top, then every other map gets its own themed SECTION (`MAP_THEME`,
 * extracted to `ui/world/mapTheme.ts` so `WorldMapPanel.tsx` can share the
 * same accents — colors anchored to `render/environment/biomes.ts`'s per-map
 * ground tones, reimplemented as plain Tailwind/CSS, this component never
 * imports `@/render`). Lists every UNLOCKED, non-boss zone (`ui/world/zones.ts`'s
 * `fastTravelTargets`); tapping a zone queues the `fastTravel` intent, the
 * engine does the real validation (aggro/locked/mid-transit/…) and rejects with
 * a `fastTravelBlocked` reason (surfaced as a `NoticeToast`, see
 * `GameClient.tsx`) — this picker's own disabled states are a best-effort UX
 * guard, not the source of truth.
 */

import { useTranslations } from "next-intl";
import { ASURA_MAP_ID, asuraHotZoneFor } from "@/engine";
import { asuraDayKeyForMs } from "@/ui/asura/schedule";
import {
  fastTravelTargets,
  isZoneUnlockedUi,
  zonesGroupedByMap,
  type UiZone,
} from "@/ui/world/zones";
import { MapIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { themeFor, stageRangeOf, type MapTheme } from "@/ui/world/mapTheme";
import { useGameStore } from "@/ui/store/gameStore";

const ALL_TARGETS = fastTravelTargets();
const TOWN_ZONE: UiZone | null = ALL_TARGETS.find((z) => z.kind === "town") ?? null;
// ดินแดนอสูร (ASURA) gets its own gated section below (locked = a mysterious
// teaser row, never the normal per-zone list) — excluded from the ordinary
// per-map grouping.
const FARM_ZONES_BY_MAP = zonesGroupedByMap(
  ALL_TARGETS.filter((z) => z.kind !== "town" && z.mapId !== ASURA_MAP_ID),
);
const ASURA_ZONES: UiZone[] = ALL_TARGETS.filter((z) => z.mapId === ASURA_MAP_ID);

/** Today's asura hot-zone farm-DEPTH index, off the CLIENT wall clock — a pure
 * cosmetic hint (see the module doc's "client-clock HINT" note). A plain
 * helper (not inlined in the component body) so the render-purity lint rule
 * doesn't flag the `Date.now()` read, same idiom as `friends/FriendsPanel.tsx`'s
 * `lastSeenLabel`. */
function currentAsuraHotZoneIdx(): number {
  return asuraHotZoneFor(asuraDayKeyForMs(Date.now()));
}

export interface FastTravelPickerProps {
  onClose: () => void;
}

function ZoneRow({
  zone,
  theme,
  prominent,
  hot,
  onSelect,
}: {
  zone: UiZone;
  theme: MapTheme;
  /** Town's own row gets bigger, gold-accented styling on top of its theme. */
  prominent?: boolean;
  /** ดินแดนอสูร daily hot zone (endgame v1) — a small 🔥 badge, no extra copy
   * (the mechanical bonus explains itself once the player farms there). */
  hot?: boolean;
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
        {hot && unlocked && (
          <span aria-hidden title={t("asuraHotZoneBadge")}>
            🔥
          </span>
        )}
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
  hotZoneIdx,
}: {
  mapId: string;
  zones: UiZone[];
  onSelect: () => void;
  /** ดินแดนอสูร daily hot zone (endgame v1) — the farm-DEPTH index (0-based
   * within this map's farm zones) to badge, or `undefined` for every other map. */
  hotZoneIdx?: number;
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
            hot={hotZoneIdx !== undefined && zone.kind === "farm" && zone.zoneIdx === hotZoneIdx}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export function FastTravelPicker({ onClose }: FastTravelPickerProps) {
  const t = useTranslations("world");
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  // ดินแดนอสูร gate — mirrors the engine's `isAsuraUnlocked` read (asura z1
  // persist-unlocked, opened by the s30 boss clear): `isZoneUnlockedUi` at
  // zoneIdx 0 is exactly that same rule off the throttled snapshot.
  const asuraUnlocked =
    ASURA_ZONES.length > 0 &&
    isZoneUnlockedUi({ mapId: ASURA_MAP_ID, zoneIdx: 0 }, unlockedZones);
  // Today's hot zone — a pure client-clock HINT (cosmetic only; the actual
  // reward multiplier is engine-authoritative off the server-clock-aligned
  // day-key `GameClient.tsx` injects once the player is actually standing in
  // asura). Computed regardless of unlock state so the badge is ready the
  // instant the section opens up.
  const asuraHotZoneIdx = currentAsuraHotZoneIdx();

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
      <Panel
        variant="gold"
        className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3"
      >
        <PanelHeader
          title={t("fastTravelTitle")}
          icon={<MapIcon className="h-5 w-5" />}
          actions={
            <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
              ✕ {t("fastTravelClose")}
            </Button>
          }
        />

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

          {/* ดินแดนอสูร (endgame v1): gated on the persist-unlock (opened by the
              s30 boss clear) — locked shows only a mysterious teaser row, never
              the normal 10-zone list (no stage numbers, no "how many kills to
              unlock" spoilage). */}
          {ASURA_ZONES.length > 0 &&
            (asuraUnlocked ? (
              <MapSection
                mapId={ASURA_MAP_ID}
                zones={ASURA_ZONES}
                onSelect={onClose}
                hotZoneIdx={asuraHotZoneIdx}
              />
            ) : (
              <div
                className={`flex min-h-11 w-full items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-left text-xs font-bold ${themeFor(ASURA_MAP_ID).row} cursor-not-allowed opacity-70`}
              >
                <span aria-hidden>{themeFor(ASURA_MAP_ID).emoji}</span>
                {t("asuraTeaserRow")}
              </div>
            ))}
        </div>
      </Panel>
    </div>
    </ModalPortal>
  );
}
