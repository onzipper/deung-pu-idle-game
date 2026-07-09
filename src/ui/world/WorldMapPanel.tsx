"use client";

/**
 * R1 "โลกใหม่ หน้าตาใหม่" W4 — the World Map panel. Same `ModalPortal` +
 * `Panel variant="gold"` + `PanelHeader` shell as `FastTravelPicker.tsx`
 * (mandatory per-project modal convention — iOS Safari's backdrop-filter
 * containing-block trap). Unlike the fast-travel picker (a lean warp menu),
 * this is the "where is everything" surface: live population, friends' /
 * party members' last-seen zones, the daily asura hot zone, and the hourly
 * world-boss window — all pure display, computed by
 * `worldMapModel.ts`'s `buildWorldMapModel` (no game logic here).
 *
 * TAP-TO-TRAVEL reuses the EXACT same rule shape `FastTravelPicker.tsx`'s
 * `ZoneRow` uses (unlocked && not-current && not-channeling && not-traveling
 * → `queueFastTravel` intent, close on select) — this component does not
 * invent a second set of travel rules, it just reads the already-unlocked
 * flag off the shared pure model instead of recomputing it. The engine is
 * still the real validator (`fastTravelBlocked` NoticeToast on reject).
 *
 * Friends data: `useFriendsPoll` is normally owned ONCE by `FriendsButton.tsx`
 * (its own doc: "the badge/toasts/panel never run three independent
 * pollers"). This panel is a FOURTH consumer mounted from a different part of
 * the tree (`HudBar.tsx`'s zone chip, not the friends hub), so per the R1 W4
 * brief ("lightest correct wiring… reuse the existing poll hook while the
 * panel is open") it runs its OWN short-lived instance — bounded to exactly
 * while this modal is mounted, same 5s-open cadence the hub uses. Accepted
 * duplication rather than plumbing a second global store slice for one panel.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ASURA_MAP_ID, CONFIG, asuraHotZoneFor } from "@/engine";
import { asuraDayKeyForMs } from "@/ui/asura/schedule";
import { MapIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { useFriendsPoll } from "@/ui/friends/useFriendsPoll";
import { useGameStore } from "@/ui/store/gameStore";
import { themeFor, stageRangeOf, type MapTheme } from "@/ui/world/mapTheme";
import { useZoneCounts } from "@/ui/world/useZoneCounts";
import {
  buildWorldMapModel,
  sumCounts,
  zoneKeyOf,
  type WorldMapSection,
  type WorldMapZoneRow,
} from "@/ui/world/worldMapModel";
import { fastTravelTargets, isZoneUnlockedUi, zonesGroupedByMap } from "@/ui/world/zones";

const ALL_GROUPS = zonesGroupedByMap(fastTravelTargets());
const ASURA_ZONE_KEYS: readonly string[] =
  ALL_GROUPS.find((g) => g.mapId === ASURA_MAP_ID)?.zones.map((z) => zoneKeyOf(z)) ?? [];

/** Today's asura hot-zone farm-DEPTH index, off the CLIENT wall clock — pure
 * cosmetic hint, same idiom as `FastTravelPicker.tsx`'s
 * `currentAsuraHotZoneIdx` (kept as a plain module-level helper so the
 * render-purity lint rule doesn't flag the `Date.now()` read inline in the
 * component body). */
function currentAsuraHotZoneIdx(): number {
  return asuraHotZoneFor(asuraDayKeyForMs(Date.now()));
}

export interface WorldMapPanelProps {
  onClose: () => void;
}

function ZoneRow({
  row,
  theme,
  prominent,
  onSelect,
}: {
  row: WorldMapZoneRow;
  theme: MapTheme;
  /** Town's own row gets bigger, gold-accented styling on top of its theme —
   * mirrors `FastTravelPicker.tsx`'s `ZoneRow`. */
  prominent?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("world");
  const tMap = useTranslations("worldMap");
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const traveling = useGameStore((s) => s.world.traveling);
  const queueFastTravel = useGameStore((s) => s.queueFastTravel);
  const pushNotice = useGameStore((s) => s.pushNotice);

  const enabled = row.unlocked && !row.isMe && !channeling && !traveling;
  const label = row.label.kind === "town" ? t("zoneTown") : t("zoneFarm", { stage: row.label.stage });

  const rowClass = !row.unlocked
    ? "cursor-not-allowed border-ddp-border bg-black/25 text-ddp-ink-muted"
    : row.isMe
      ? `${theme.row} ring-2 ring-ddp-gold-bright cursor-default`
      : channeling || traveling
        ? "cursor-not-allowed border-ddp-border bg-black/25 text-ddp-ink-muted"
        : theme.row;

  return (
    <button
      type="button"
      disabled={!enabled}
      title={!row.unlocked ? t("lockedTooltip") : undefined}
      onClick={() => {
        if (!enabled) {
          // Only the locked case gets a notice — isMe/channeling/traveling are
          // silent no-ops, same as `FastTravelPicker.tsx`'s `ZoneRow`.
          if (!row.unlocked) pushNotice("fastTravelBlocked.locked");
          return;
        }
        queueFastTravel({ mapId: row.mapId, zoneIdx: row.zoneIdx });
        // Close on select (game-ux rule): the player wants to SEE the travel
        // channel start, not the menu.
        onSelect();
      }}
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-(--ddp-radius-md) border px-3 py-2 text-left font-bold transition-colors active:scale-[0.98] ${
        prominent ? "text-sm" : "text-xs"
      } ${rowClass}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {row.label.kind === "town" && (
          <span aria-hidden className={prominent ? "text-lg" : undefined}>
            🏠
          </span>
        )}
        <span className="truncate">{label}</span>
        {row.isHot && row.unlocked && (
          <span aria-hidden title={t("asuraHotZoneBadge")}>
            🔥
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {row.hasPartyMember && (
          <span
            aria-hidden
            title={tMap("partyMemberTooltip")}
            className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
          />
        )}
        {row.friendInitials.length > 0 && (
          <span
            className="flex items-center -space-x-1.5"
            title={tMap("friendsLastSeenTooltip")}
            aria-label={tMap("friendsLastSeenTooltip")}
          >
            {row.friendInitials.map((initial, i) => (
              <span
                key={i}
                aria-hidden
                className="flex h-5 w-5 items-center justify-center rounded-full border border-ddp-border bg-black/50 text-[10px] font-bold text-ddp-ink"
              >
                {initial}
              </span>
            ))}
            {row.friendOverflowCount > 0 && (
              <span aria-hidden className="pl-1 text-[10px] font-bold">
                +{row.friendOverflowCount}
              </span>
            )}
          </span>
        )}
        {row.count !== null && (
          <span
            title={tMap("populationTooltip")}
            className="rounded-full border border-ddp-border-soft bg-black/30 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
          >
            👥 {row.count}
          </span>
        )}
        {row.isMe ? (
          <span className="text-[10px] uppercase">{t("fastTravelCurrent")}</span>
        ) : !row.unlocked ? (
          <span aria-hidden>🔒</span>
        ) : null}
      </span>
    </button>
  );
}

function MapSection({ section, onSelect }: { section: WorldMapSection; onSelect: () => void }) {
  const tMaps = useTranslations("content.maps");
  const t = useTranslations("world");
  const tMap = useTranslations("worldMap");
  const theme = themeFor(section.mapId);
  const { min, max } = stageRangeOf(section.rows);
  const townRow = section.rows.find((r) => r.kind === "town") ?? null;
  const otherRows = section.rows.filter((r) => r.kind !== "town");

  return (
    <section className="flex flex-col gap-1.5">
      <div
        className={`flex items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-extrabold tracking-wide ${theme.header}`}
      >
        <span aria-hidden>{theme.emoji}</span>
        <span className="truncate">{tMaps(`${section.mapId}.name`)}</span>
        {section.hasBossWindow && (
          <span
            title={tMap("bossWindowBadge")}
            className="shrink-0 animate-pulse rounded-full border border-amber-400/60 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-200"
          >
            {tMap("bossWindowBadge")}
          </span>
        )}
        <span className="ml-auto shrink-0 font-semibold opacity-80">
          {t("fastTravelStageRange", { min, max })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {townRow && <ZoneRow row={townRow} theme={theme} prominent onSelect={onSelect} />}
        {otherRows.map((row) => (
          <ZoneRow key={row.zoneKey} row={row} theme={theme} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

export function WorldMapPanel({ onClose }: WorldMapPanelProps) {
  const t = useTranslations("world");
  const tMap = useTranslations("worldMap");

  const world = useGameStore((s) => s.world);
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const party = useGameStore((s) => s.party);
  const worldBossStatus = useGameStore((s) => s.worldBossStatus);

  // See the module doc — a deliberate second poller, bounded to this panel's
  // lifetime, per the R1 W4 brief's "lightest correct wiring" call.
  const friendsPoll = useFriendsPoll(true);
  const counts = useZoneCounts({ open: true });

  const myZoneKey = zoneKeyOf(world);
  const asuraUnlocked = isZoneUnlockedUi({ mapId: ASURA_MAP_ID, zoneIdx: 0 }, unlockedZones);
  const hotZoneIdx = currentAsuraHotZoneIdx();
  // World boss always spawns on `CONFIG.worldBoss.mapId` (map1) — see that
  // config knob's doc. The window's specific ZONE stays a mystery (never
  // surfaced here), only the MAP gets the header badge.
  const bossWindowMapId = worldBossStatus.kind !== "idle" ? CONFIG.worldBoss.mapId : null;

  const friends = useMemo(
    () =>
      (friendsPoll.panel?.friends ?? []).map((f) => ({
        displayName: f.displayName,
        lastZone: f.lastZone,
      })),
    [friendsPoll.panel],
  );
  const partyMemberNames = useMemo(
    () => (party?.members ?? []).map((m) => ({ displayName: m.displayName, zoneKey: m.lastZone })),
    [party],
  );

  const sections = useMemo(
    () =>
      buildWorldMapModel({
        groupedZones: ALL_GROUPS,
        unlockedZones,
        myZoneKey,
        counts,
        friends,
        partyMemberNames,
        hotZoneIdx,
        bossWindowMapId,
      }),
    [unlockedZones, myZoneKey, counts, friends, partyMemberNames, hotZoneIdx, bossWindowMapId],
  );

  // ดินแดนอสูร teaser aggregate (locked-only): a total headcount across ALL
  // its zones, never per-zone — "people are out there" hype without spoiling
  // which zone (mirrors `FastTravelPicker.tsx`'s gated teaser row, extended
  // with a population hint per the W4 brief).
  const asuraTeaserCount = sumCounts(ASURA_ZONE_KEYS, counts);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={tMap("title")}
      >
        <button
          type="button"
          aria-label={tMap("close")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <Panel
          variant="gold"
          className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-3"
        >
          <PanelHeader
            title={tMap("title")}
            icon={<MapIcon className="h-5 w-5" />}
            actions={
              <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
                ✕ {tMap("close")}
              </Button>
            }
          />

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {sections.map((section) =>
              section.mapId === ASURA_MAP_ID && !asuraUnlocked ? (
                <div
                  key={section.mapId}
                  className={`flex min-h-11 w-full items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-left text-xs font-bold ${themeFor(section.mapId).row} cursor-not-allowed opacity-70`}
                >
                  <span aria-hidden>{themeFor(section.mapId).emoji}</span>
                  <span className="flex-1">{t("asuraTeaserRow")}</span>
                  {asuraTeaserCount !== null && (
                    <span
                      title={tMap("populationTooltip")}
                      className="shrink-0 rounded-full border border-ddp-border-soft bg-black/30 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                    >
                      👥 {asuraTeaserCount}
                    </span>
                  )}
                </div>
              ) : (
                <MapSection key={section.mapId} section={section} onSelect={onClose} />
              ),
            )}
          </div>
        </Panel>
      </div>
    </ModalPortal>
  );
}
