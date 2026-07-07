/**
 * Pure helpers for the Friends panel (M8 Phase 1) — no React/i18n dependency
 * (mirrors `ui/hof/format.ts`'s split). Components compose the localized copy
 * around these plain values.
 */

import { zoneAt, type ZoneKind } from "@/engine";

export interface ParsedZone {
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  stage: number;
}

/** Parses the server's "mapId:zoneIdx" composite + resolves it through the
 * engine's own `zoneAt` (kind/stage) — same read the `WalkControls` HUD uses
 * for the CURRENT player, so a friend's zone reads identically. Returns null
 * for a malformed/unrecognized composite (the caller falls back to raw text). */
export function parseFriendZone(composite: string | null): ParsedZone | null {
  if (!composite) return null;
  const sepIdx = composite.indexOf(":");
  if (sepIdx < 0) return null;
  const mapId = composite.slice(0, sepIdx);
  const zoneIdxStr = composite.slice(sepIdx + 1);
  const zoneIdx = Number(zoneIdxStr);
  if (!mapId || !Number.isInteger(zoneIdx) || zoneIdx < 0) return null;
  const zone = zoneAt({ mapId, zoneIdx });
  // zoneAt falls back to a default zone on an unrecognized location rather
  // than returning null — cross-check the resolved id matches what we asked
  // for so a stale/foreign mapId never silently mislabels as zone 0.
  if (zone.mapId !== mapId || zone.zoneIdx !== zoneIdx) return null;
  return { mapId, zoneIdx, kind: zone.kind, stage: zone.stage };
}

export type RelativeTimeUnit = "justNow" | "minutes" | "hours" | "days";

export interface RelativeTime {
  unit: RelativeTimeUnit;
  value: number;
}

/** Coarse "last seen" breakdown — minutes under an hour, hours under a day,
 * days beyond that. `nowMs`/`thenIso` are plain inputs so this stays
 * headlessly testable without faking a clock. */
export function relativeTimeFrom(nowMs: number, thenIso: string): RelativeTime {
  const thenMs = new Date(thenIso).getTime();
  const deltaSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (deltaSec < 60) return { unit: "justNow", value: 0 };
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  const days = Math.floor(hours / 24);
  return { unit: "days", value: days };
}
