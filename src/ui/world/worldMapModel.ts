/**
 * R1 "โลกใหม่ หน้าตาใหม่" W4 — pure view-model builder for the World Map panel
 * (`WorldMapPanel.tsx`). No React/fetch/DOM here (headlessly testable,
 * `__tests__/worldMapModel.test.ts`) — every display decision (lock state,
 * population badge, friend chips, party dot, hot-zone badge, boss-window
 * header) lives HERE so the panel component is pure rendering + store reads.
 *
 * Reuses `ui/world/zones.ts`'s enumeration/unlock helpers rather than
 * re-deriving them (same "one source of truth for unlock rules" convention
 * `FastTravelPicker.tsx` already follows) and `ASURA_MAP_ID` from `@/engine`
 * (a plain config constant, not engine logic — same import `FastTravelPicker`
 * makes).
 *
 * zoneKey format is the SAME "mapId:zoneIdx" composite used server-side
 * (`Character.lastZone`, `src/server/save.ts`) and by the relay's presence
 * rooms (`WorldSession.setZone`) — this is what lets `counts`/`friends`/
 * `partyMemberNames` (all keyed or stamped in that same format) line up
 * against `groupedZones` without any translation layer.
 */

import { ASURA_MAP_ID, type ZoneKind } from "@/engine";
import { isZoneUnlockedUi, type UiMapGroup, type UiZone } from "@/ui/world/zones";

/** Max friend-initial chips shown per row before collapsing into "+n". */
const MAX_FRIEND_INITIALS = 3;

export function zoneKeyOf(loc: { mapId: string; zoneIdx: number }): string {
  return `${loc.mapId}:${loc.zoneIdx}`;
}

/** Minimal friend shape the model needs — a subset of `FriendWire`
 * (`ui/friends/types.ts`), redeclared here so this module stays free of a
 * cross-feature import (same "DTO redeclared at the boundary" convention
 * `ui/world/zones.ts`'s own doc comment describes). */
export interface WorldMapFriendInput {
  displayName: string | null;
  /** "mapId:zoneIdx", or null if the friend has never saved a location. */
  lastZone: string | null;
}

/** Minimal party-member shape the model needs — a subset of `PartyMemberWire`.
 * Callers should exclude MY OWN entry (the row's `isMe` flag already covers
 * "this is where I am" — a party dot on my own row would be redundant). */
export interface WorldMapPartyMemberInput {
  displayName: string | null;
  zoneKey: string | null;
}

export type WorldMapZoneLabel = { kind: "town" } | { kind: "farm"; stage: number };

export interface WorldMapZoneRow {
  zoneKey: string;
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  stage: number;
  /** Translation-ready pieces — the panel resolves these via `t("world.zoneTown")`
   * / `t("world.zoneFarm", { stage })`, never a hardcoded string here. */
  label: WorldMapZoneLabel;
  unlocked: boolean;
  /** True iff this is MY current location. */
  isMe: boolean;
  /** Live relay population for this zone, or `null` when there's no data to
   * show (relay unreachable/old, OR the relay simply reports nobody here —
   * see the module doc's "count" section below). Never 0 — a present, non-null
   * count is always positive (mirrors the relay's own "never emit an empty
   * room" behavior), so the panel's `count == null` check is the ONLY branch
   * it needs to hide the badge. */
  count: number | null;
  /** Up to `MAX_FRIEND_INITIALS` initials of friends whose last-saved
   * location is this zone. */
  friendInitials: string[];
  /** How many MORE friends are here beyond the shown initials (0 = none). */
  friendOverflowCount: number;
  /** True iff a party member's last-saved location is this zone. */
  hasPartyMember: boolean;
  /** ดินแดนอสูร daily hot zone (endgame v1) — only ever true for the asura map. */
  isHot: boolean;
}

export interface WorldMapSection {
  mapId: string;
  rows: WorldMapZoneRow[];
  /** True iff the hourly world boss's current window is happening somewhere
   * in THIS map (never a specific zone — the boss stays a "hunt for it"
   * mystery, see `WorldMapPanel.tsx`'s header copy). */
  hasBossWindow: boolean;
}

export interface BuildWorldMapModelInput {
  /** Every listed map's zone group, in display order (town+farm only — boss
   * rooms are never a fast-travel target, see `fastTravelTargets()`'s doc).
   * Typically `zonesGroupedByMap(fastTravelTargets())`. */
  groupedZones: UiMapGroup[];
  unlockedZones: Record<string, number>;
  /** My current "mapId:zoneIdx". */
  myZoneKey: string;
  /** Relay population snapshot (`GET /presence/counts`'s `counts` field), or
   * `null` while unavailable (no relay minted, old relay, network error —
   * see `useZoneCounts.ts`). `null` degrades EVERY row's `count` to `null`
   * (badges hidden panel-wide) rather than partially stale data. */
  counts: Record<string, number> | null;
  friends: WorldMapFriendInput[];
  /** Other party members' last-saved locations (MY OWN entry excluded by the
   * caller — see `WorldMapPartyMemberInput`'s doc). */
  partyMemberNames: WorldMapPartyMemberInput[];
  /** Today's asura hot farm-zoneIdx (`asuraHotZoneFor`'s result), or
   * `undefined` when there's nothing to badge (mirrors
   * `FastTravelPicker.tsx`'s `MapSection`'s `hotZoneIdx` prop). */
  hotZoneIdx?: number;
  /** The map the hourly world boss's CURRENT window is on, or `null` when no
   * window is active (`kind: "idle"`). Marks that map's section header only —
   * never a specific zone. */
  bossWindowMapId: string | null;
}

function initialFor(displayName: string | null): string {
  const trimmed = displayName?.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

function labelFor(zone: UiZone): WorldMapZoneLabel {
  return zone.kind === "town" ? { kind: "town" } : { kind: "farm", stage: zone.stage };
}

export function buildWorldMapModel(input: BuildWorldMapModelInput): WorldMapSection[] {
  const {
    groupedZones,
    unlockedZones,
    myZoneKey,
    counts,
    friends,
    partyMemberNames,
    hotZoneIdx,
    bossWindowMapId,
  } = input;

  const friendInitialsByZone = new Map<string, string[]>();
  for (const f of friends) {
    if (!f.lastZone) continue;
    const initial = initialFor(f.displayName);
    const existing = friendInitialsByZone.get(f.lastZone);
    if (existing) existing.push(initial);
    else friendInitialsByZone.set(f.lastZone, [initial]);
  }

  const partyZoneKeys = new Set<string>();
  for (const m of partyMemberNames) {
    if (m.zoneKey) partyZoneKeys.add(m.zoneKey);
  }

  return groupedZones.map((group) => ({
    mapId: group.mapId,
    hasBossWindow: bossWindowMapId !== null && bossWindowMapId === group.mapId,
    rows: group.zones.map((zone) => {
      const zoneKey = zoneKeyOf(zone);
      const rawCount = counts ? (counts[zoneKey] ?? 0) : 0;
      const friendList = friendInitialsByZone.get(zoneKey) ?? [];
      return {
        zoneKey,
        mapId: zone.mapId,
        zoneIdx: zone.zoneIdx,
        kind: zone.kind,
        stage: zone.stage,
        label: labelFor(zone),
        unlocked: isZoneUnlockedUi(zone, unlockedZones),
        isMe: zoneKey === myZoneKey,
        count: counts !== null && rawCount > 0 ? rawCount : null,
        friendInitials: friendList.slice(0, MAX_FRIEND_INITIALS),
        friendOverflowCount: Math.max(0, friendList.length - MAX_FRIEND_INITIALS),
        hasPartyMember: partyZoneKeys.has(zoneKey),
        isHot:
          zone.mapId === ASURA_MAP_ID &&
          zone.kind === "farm" &&
          hotZoneIdx !== undefined &&
          zone.zoneIdx === hotZoneIdx,
      };
    }),
  }));
}

/** Sums a raw `counts` map over a set of zone keys — used by the panel for
 * the asura-locked teaser row's aggregate "someone's out there" hint (never
 * per-zone, so it can't spoil which zone). `null` in ⇒ `null` out (no data to
 * sum); an all-zero sum also degrades to `null` (nothing to show). */
export function sumCounts(zoneKeys: readonly string[], counts: Record<string, number> | null): number | null {
  if (counts === null) return null;
  let total = 0;
  for (const k of zoneKeys) total += counts[k] ?? 0;
  return total > 0 ? total : null;
}
