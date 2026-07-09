"use client";

/**
 * R2-W5 "จอเกมใหญ่ + HUD ซ้อน" originally gated this to desktop only. R2-W2
 * "fullscreen HUD" removed that gate — the arena is now the ENTIRE screen on
 * every viewport (there's no separate "in-flow HUD chrome" left below a
 * boxed canvas to fall back to), so the quest/goal tracker (`GoalLadder`)
 * always portals into the arena's left-mid overlay slot `GameHud.tsx`
 * renders — exactly ONE `<GoalLadder />` is ever mounted, full stop.
 *
 * R2.6 Wave 1: `GoalLadder`'s collapse-to-chip is now viewport-independent
 * (driven by the persisted `questTrackerCollapsed` store field — see that
 * file's doc), so the `useMediaQuery`/`compact` prop this slot used to thread
 * through is GONE.
 *
 * `overlayRef` targets the small absolutely-positioned slot `GameHud.tsx`
 * renders inside the arena container (see its comment for placement/scrim
 * reasoning) — always present in the DOM (so the ref resolves) once mounted.
 */

import { createPortal } from "react-dom";
import { useEffect, useState, type RefObject } from "react";
import { GoalLadder } from "@/ui/components/GoalLadder";

export function GoalLadderOverlaySlot({
  overlayRef,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
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
      <GoalLadder />
    </div>,
    portalTarget,
  );
}
