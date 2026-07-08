"use client";

/**
 * Detects a fresh cooldown-start (cd jumped back up from the throttled
 * snapshot) and returns a bump-on-cast key so a caller can `key={castKey}` its
 * CSS cooldown-sweep overlay to restart it exactly at the moment of use.
 * Extracted from `SkillBar.tsx` (M5) so `ConsumableBar.tsx`'s potion buttons
 * (owner ask, 2026-07-09) can replicate the EXACT same sweep technique.
 */

import { useEffect, useRef, useState } from "react";

export function useCastKey(cd: number): number {
  const prev = useRef(cd);
  const [castKey, setCastKey] = useState(0);
  useEffect(() => {
    if (cd > prev.current + 0.05) setCastKey((k) => k + 1);
    prev.current = cd;
  }, [cd]);
  return castKey;
}
