/**
 * Pure query-key + URL building for `/api/hof` (M7.95 Hall of Fame). No
 * React/DOM — headlessly testable, same tier as `ui/goalLadder.ts`'s pure
 * selection logic. `HallOfFamePanel.tsx`'s in-panel cache is keyed by
 * `hofQueryKey` so switching back to an already-fetched board/stage/class
 * combo never re-hits the network this session.
 */

import type { HofQuery } from "./types";

/** Deterministic cache key for one (board, bossStage, cls) combo. `bossStage`
 * is folded out for non-boss boards (`-`) so `{board:"level", bossStage:5}`
 * and `{board:"level", bossStage:10}` share one cache entry — the stage
 * sub-select is invisible/irrelevant off the boss board. */
export function hofQueryKey(query: HofQuery): string {
  const stagePart = query.board === "boss" ? String(query.bossStage) : "-";
  return `${query.board}:${stagePart}:${query.cls}`;
}

/** Builds the `GET /api/hof` URL for a query — `bossStage` is only appended
 * when `board === "boss"` (the route's contract only reads it there). */
export function buildHofUrl(query: HofQuery): string {
  const params = new URLSearchParams({ board: query.board, cls: query.cls });
  if (query.board === "boss") params.set("bossStage", String(query.bossStage));
  return `/api/hof?${params.toString()}`;
}
