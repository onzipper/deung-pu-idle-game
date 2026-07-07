/**
 * M7.9/M7.95 server-wide announcement feed — wire + display shapes.
 * Mirrors `ui/gear/types.ts`'s "wire DTO vs display-ready entry" split.
 */

/** Feed kinds the banner knows how to render:
 *  - "refine"   — a +8/+9/+10 refine landing (M7.9; carries templateId + refineLevel).
 *  - "levelCap" — the first player to reach the level cap (M7.95; refineLevel = cap level).
 *  - "rankOne"  — a character newly took #1 on the power board (M7.95). */
export type AnnouncementKind = "refine" | "levelCap" | "rankOne";

/** The wire shape returned by `/api/save` (GET + POST) — see
 * `src/server/items.ts`'s `RefineAnnouncementDTO` (kept structurally
 * identical; this is the client-side mirror so `ui/` never imports from
 * `@/server`). */
export interface AnnouncementWire {
  id: string;
  /** Feed kind; an unknown/future kind is dropped client-side (forward-compatible). */
  kind: string;
  characterId: string;
  charName: string;
  /** refine kind only; null for levelCap/rankOne. */
  templateId: string | null;
  /** refine kind: +level; levelCap kind: the cap level reached; null for rankOne. */
  refineLevel: number | null;
  /** ISO timestamp. */
  at: string;
}

/** A display-ready queue entry (the item name is localized client-side from
 * `templateId` at RENDER time, not stored pre-localized — see
 * `AnnouncementBanner.tsx`). */
export interface AnnouncementEntry {
  id: string;
  kind: AnnouncementKind;
  charName: string;
  /** refine kind only. */
  templateId: string | null;
  /** refine kind: +level; levelCap kind: the cap level reached; null otherwise. */
  refineLevel: number | null;
}
