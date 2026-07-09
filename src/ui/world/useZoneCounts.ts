"use client";

/**
 * R1 W4 World Map panel — the relay population poll. Reads
 * `getCachedRelayUrl()` (`src/app/(game)/presence/relayUrlCache.ts` — the
 * ONE place the client learns the relay's ws(s):// URL, populated whenever
 * `WorldSession.mintTicket` runs) and converts it to the relay's plain HTTP
 * `GET /presence/counts` endpoint, exactly the recovery path that module's
 * doc comment describes.
 *
 * Polls every `pollMs` (default `DEFAULT_POLL_MS` = the original 10s
 * `WorldMapPanel` cadence) ONLY while `open` is true (the panel is mounted +
 * visible) — same "don't poll a closed surface" discipline as
 * `useFriendsPoll`'s open/closed cadence split, just single-rate here since
 * there's no badge to keep warm while closed. `AbortController` cancels the
 * in-flight request on close/unmount so a slow relay response never lands
 * after the panel is gone. Also pauses (skips the fetch, keeps the interval
 * armed) while `document.visibilityState !== "visible"` — a backgrounded tab
 * has no business polling a relay every few seconds (R2.5-W3, added for
 * `MiniMapCard.tsx`'s ALWAYS-mounted, slower-cadence consumer).
 *
 * Degrades to `null` (never throws, never surfaces a NoticeToast — this is a
 * pure population HINT, not authoritative game state) whenever there's
 * nothing to show yet: no relay URL minted this session (fresh load, or the
 * relay isn't deployed), a malformed relay URL, a non-2xx response, or a
 * network error. A transient failure AFTER a successful fetch keeps the
 * last-good counts on screen rather than blanking every badge — only the
 * "never had one" case is `null`. Callers that want a silently-hidden chip on
 * "no data yet" (rather than a loading state) should treat `null` as
 * "render nothing", exactly like `WorldMapPanel.tsx`'s `row.count !== null`.
 */

import { useEffect, useState } from "react";
import { getCachedRelayUrl } from "@/app/(game)/presence/relayUrlCache";

const DEFAULT_POLL_MS = 10_000;

export interface UseZoneCountsOptions {
  /** Poll only while true (panel mounted+visible, or an always-on consumer
   * that just wants a slower cadence — e.g. `MiniMapCard.tsx`). */
  open: boolean;
  /** Poll interval in ms — defaults to `DEFAULT_POLL_MS` (10s, `WorldMapPanel`'s
   * original cadence). A slower-cadence consumer (e.g. the always-mounted
   * minimap card) should pass a larger value so it doesn't hammer the relay
   * just for a background population hint. */
  pollMs?: number;
}

interface CountsWire {
  v?: number;
  counts?: Record<string, number>;
}

/** ws(s)://host[:port] → http(s)://host[:port]/presence/counts. Returns
 * `null` for anything that doesn't parse as a URL (defensive — the cached
 * value always came from a server-minted ticket, but this hook must never
 * throw). */
function toCountsUrl(relayUrl: string): string | null {
  try {
    const u = new URL(relayUrl);
    if (u.protocol === "ws:") u.protocol = "http:";
    else if (u.protocol === "wss:") u.protocol = "https:";
    u.pathname = "/presence/counts";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Live relay population per "mapId:zoneIdx" zoneKey, or `null` while
 * unavailable. See the module doc for the degrade rules. */
export function useZoneCounts({
  open,
  pollMs = DEFAULT_POLL_MS,
}: UseZoneCountsOptions): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();

    async function poll(): Promise<void> {
      if (document.visibilityState === "hidden") return; // paused while backgrounded
      const relayUrl = getCachedRelayUrl();
      const url = relayUrl ? toCountsUrl(relayUrl) : null;
      if (!url) return; // no relay minted yet / undeployed — leave last-good as-is
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as CountsWire;
        if (cancelled) return;
        if (data && typeof data.counts === "object" && data.counts !== null) {
          setCounts(data.counts);
        }
      } catch {
        // Network error / abort — silently keep the last-good snapshot.
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      controller.abort();
    };
  }, [open, pollMs]);

  return counts;
}
