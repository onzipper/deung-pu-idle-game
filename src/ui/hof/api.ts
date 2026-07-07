/**
 * M7.95 Hall of Fame — thin `fetch` wrapper over `GET /api/hof` (same tier as
 * `ui/gear/api.ts`'s wrappers, read-only from here). The backend lands in
 * parallel with this UI wave, so a non-2xx/network failure is a normal,
 * expected transient state (not just an edge case) — the panel shows
 * `hof.notOpenYet` rather than crashing, per the task brief.
 *
 * Distinguishes an intentional `AbortController.abort()` (tab/filter change,
 * or the panel closing mid-fetch) from a genuine failure so the panel never
 * flashes an error state for its own superseded/cancelled request.
 */

import type { HofQuery, HofResponse } from "./types";
import { buildHofUrl } from "./query";

export type HofFetchResult =
  | { kind: "ok"; data: HofResponse }
  | { kind: "aborted" }
  | { kind: "error" };

export async function fetchHof(
  query: HofQuery,
  signal: AbortSignal,
): Promise<HofFetchResult> {
  try {
    const res = await fetch(buildHofUrl(query), { signal });
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as HofResponse;
    return { kind: "ok", data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { kind: "aborted" };
    return { kind: "error" };
  }
}
