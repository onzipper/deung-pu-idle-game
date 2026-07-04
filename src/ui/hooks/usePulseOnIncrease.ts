"use client";

/**
 * M4 "light touch" UI juice: returns `true` for a brief window right after
 * `value` increases versus its previous render (gold ticking up, an upgrade
 * level going up after a buy). Purely CSS-driven from there (see
 * `globals.css`'s `gold-pulse` / `buy-pulse` keyframes) — no Framer Motion/GSAP
 * needed for a one-shot scale+glow pulse, and this only reacts to the already-
 * throttled Zustand snapshot, never per-frame engine state (CLAUDE.md's
 * "no per-frame game state in ui/" rule).
 */

import { useEffect, useRef, useState } from "react";

export function usePulseOnIncrease(value: number, durationMs = 260): boolean {
  const prev = useRef(value);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (value > prev.current) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), durationMs);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value, durationMs]);

  return pulsing;
}
