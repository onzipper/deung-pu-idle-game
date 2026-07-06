/**
 * M7.9 server-wide high-refine announcement feed — wire + display shapes.
 * Mirrors `ui/gear/types.ts`'s "wire DTO vs display-ready entry" split.
 */

/** The wire shape returned by `/api/save` (GET + POST) — see
 * `src/server/items.ts`'s `RefineAnnouncementDTO` (kept structurally
 * identical; this is the client-side mirror so `ui/` never imports from
 * `@/server`). */
export interface AnnouncementWire {
  id: string;
  characterId: string;
  charName: string;
  templateId: string;
  refineLevel: number;
  /** ISO timestamp. */
  at: string;
}

/** A display-ready queue entry (the item name is localized client-side from
 * `templateId` at RENDER time, not stored pre-localized — see
 * `AnnouncementBanner.tsx`). */
export interface AnnouncementEntry {
  id: string;
  charName: string;
  templateId: string;
  refineLevel: number;
}
