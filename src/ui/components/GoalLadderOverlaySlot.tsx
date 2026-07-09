"use client";

/**
 * R2-W5 "จอเกมใหญ่ + HUD ซ้อน" (docs/ui-reference-map.md): on desktop (md+)
 * the quest/goal tracker (`GoalLadder`) moves from in-flow HUD chrome onto
 * the arena as a top-left overlay card; on mobile portrait it stays exactly
 * where it always has — in normal document flow below
 * `WalkControls`/`TownNpcPanelHost` (unchanged DOM position, zero layout
 * diff). `GoalLadder.tsx`'s own logic/markup is untouched — this component
 * only decides WHERE it mounts.
 *
 * Exactly ONE `<GoalLadder />` is ever mounted at a time — never a CSS-only
 * show-one-hide-other duplicate. The onboarding overlay's `useAnchorRect.ts`
 * does a plain `document.querySelector('[data-onboarding-anchor="goal-ladder"]')`,
 * which returns whichever match is FIRST in DOM order regardless of CSS
 * visibility; two simultaneous copies (one `hidden`) would risk the FTUE
 * spotlight measuring a zero-size hidden element. So this portals the SAME
 * element into a different DOM parent depending on the LIVE viewport width
 * (`useMediaQuery`, a JS read — not a `md:` class), which actually unmounts
 * the inline copy before mounting the overlay copy (and vice versa) when the
 * breakpoint flips.
 *
 * `overlayRef` targets the small absolutely-positioned slot `GameHud.tsx`
 * renders inside the arena container (see its comment for placement/scrim
 * reasoning) — always present in the DOM (so the ref resolves), but only
 * ever a portal target once `isDesktop` flips true.
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
  // renders the slot div unconditionally) — re-read on mount / whenever the
  // desktop flag flips, same "wait for the client DOM to exist" idiom as
  // `ModalPortal.tsx`.
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setPortalTarget(overlayRef.current);
  }, [overlayRef, isDesktop]);

  if (!isDesktop) return <GoalLadder />;
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
