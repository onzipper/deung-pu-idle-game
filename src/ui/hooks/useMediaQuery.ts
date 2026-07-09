"use client";

/**
 * SSR-safe media-query subscription via `useSyncExternalStore` (same
 * hydration-safe idiom `ModalPortal.tsx` uses for "am I mounted on the
 * client yet"). Returns `false` on the server/first paint — matches
 * Tailwind's mobile-first default — and syncs to the live value once
 * mounted. Introduced for R2-W5's desktop arena-overlay work
 * (`GoalLadderOverlaySlot.tsx`), which needs a JS-side breakpoint read (not
 * just a CSS class) to decide which single DOM parent a shared element
 * portals into.
 */

import { useSyncExternalStore } from "react";

function subscribe(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
