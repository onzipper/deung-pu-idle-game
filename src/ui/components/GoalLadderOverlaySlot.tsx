"use client";

/**
 * R2-W5 "จอเกมใหญ่ + HUD ซ้อน" originally gated this to desktop only. R2-W2
 * "fullscreen HUD" removes that gate — the arena is now the ENTIRE screen on
 * every viewport (there's no separate "in-flow HUD chrome" left below a
 * boxed canvas to fall back to), so the quest/goal tracker (`GoalLadder`)
 * always portals into the arena's left-mid overlay slot `GameHud.tsx`
 * renders. `isDesktop` is still read (via `useMediaQuery`) and passed down as
 * `GoalLadder`'s `compact` prop, which now drives a MOBILE-ONLY
 * collapsed-summary/tap-to-expand presentation INSIDE `GoalLadder` itself
 * (see that file's doc) rather than choosing between two different mount
 * points — so exactly ONE `<GoalLadder />` is ever mounted, full stop, no
 * portal-target branching needed anymore.
 *
 * `overlayRef` targets the small absolutely-positioned slot `GameHud.tsx`
 * renders inside the arena container (see its comment for placement/scrim
 * reasoning) — always present in the DOM (so the ref resolves) once mounted.
 */

import { createPortal } from "react-dom";
import { useEffect, useState, type RefObject } from "react";
import { GoalLadder } from "@/ui/components/GoalLadder";
import { useMediaQuery } from "@/ui/hooks/useMediaQuery";

const DESKTOP_QUERY = "(min-width: 768px)"; // Tailwind's `md:` breakpoint

export function GoalLadderOverlaySlot({
  overlayRef,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  // `overlayRef.current` is already attached by the time this runs (GameHud
  // renders the slot div unconditionally) — re-read on mount, same "wait for
  // the client DOM to exist" idiom as `ModalPortal.tsx`.
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setPortalTarget(overlayRef.current);
  }, [overlayRef]);

  if (!portalTarget) return null;
  // The overlay slot div itself is `pointer-events-none` (never blocks the
  // arena's own tap/hit-testing) — restore `pointer-events-auto` for the
  // card so its buttons stay tappable, same convention as `BuffBadgeHub`'s
  // per-chip restore.
  return createPortal(
    <div className="pointer-events-auto">
      <GoalLadder compact={!isDesktop} />
    </div>,
    portalTarget,
  );
}
