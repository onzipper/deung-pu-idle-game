"use client";

/**
 * Tracks the viewport-relative bounding rect of `[data-onboarding-anchor="X"]`
 * for the overlay's spotlight. Deliberately NOT driven by the game loop
 * (rule: no per-frame animation through React state) — HUD layout only
 * changes on resize/content reflow, so this recomputes on:
 *  - anchor change (new step),
 *  - window resize,
 *  - a coarse 400ms poll as a cheap fallback for reflow that resize/observer
 *    don't catch (e.g. a HUD row wrapping when its own content changes width,
 *    which ResizeObserver on the target itself DOES catch, so the poll is
 *    mostly a safety net, not the primary mechanism).
 */

import { useEffect, useState } from "react";
import type { OnboardingAnchor } from "@/ui/onboarding/steps";

const POLL_MS = 400;

export function useAnchorRect(anchor: OnboardingAnchor | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Every branch funnels through this one nested helper (rather than a
    // bare top-level `setRect(...)` in the effect body) so subscribing to
    // DOM/resize events and computing the "no anchor" case read the same way
    // to the effect-linter: a callback reacting to an external event, not a
    // synchronous render-time state sync.
    const measure = (): void => {
      if (cancelled) return;
      if (!anchor) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-onboarding-anchor="${anchor}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };

    measure();
    window.addEventListener("resize", measure);
    const poll = window.setInterval(measure, POLL_MS);

    const el = anchor ? document.querySelector(`[data-onboarding-anchor="${anchor}"]`) : null;
    const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el as Element);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
      window.clearInterval(poll);
      ro?.disconnect();
    };
  }, [anchor]);

  return rect;
}
