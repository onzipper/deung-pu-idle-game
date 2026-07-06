/**
 * Pure ingest logic for the server-wide high-refine announcement feed (M7.9).
 * No React/DOM/store — headlessly testable, same tier as `ui/patchNotes.ts`'s
 * decision function. `gameStore.ts`'s `ingestAnnouncementFeed` action is the
 * only caller; it owns the actual store-state side effects.
 */

import type { AnnouncementEntry, AnnouncementWire } from "./types";

export interface IngestAnnouncementsResult {
  /** New entries to append to the display queue, OLDEST-first (the server
   * feed itself is newest-first — see `recentAnnouncements`'s doc — so this
   * reverses it back into "the order they actually happened"). */
  toQueue: AnnouncementEntry[];
  /** Updated seen-id set — every wire id observed this call is added, even a
   * self-excluded one, so a later poll (the feed query re-returns the same
   * last-5-minutes window every time, not just brand-new rows) never
   * re-considers it. */
  seenIds: Set<string>;
}

/**
 * Filters a raw feed batch down to genuinely-new, not-mine entries, ready to
 * append to the display queue. `myCharacterId` is `null` pre-boot (nothing to
 * exclude yet — safe default, since the feed is usually empty that early
 * anyway).
 */
export function ingestAnnouncements(
  wire: readonly AnnouncementWire[],
  seenIds: ReadonlySet<string>,
  myCharacterId: string | null,
): IngestAnnouncementsResult {
  const nextSeen = new Set(seenIds);
  const fresh: AnnouncementEntry[] = [];
  for (const a of [...wire].reverse()) {
    if (nextSeen.has(a.id)) continue;
    nextSeen.add(a.id);
    if (myCharacterId !== null && a.characterId === myCharacterId) continue; // self-exclude
    fresh.push({
      id: a.id,
      charName: a.charName,
      templateId: a.templateId,
      refineLevel: a.refineLevel,
    });
  }
  return { toQueue: fresh, seenIds: nextSeen };
}
