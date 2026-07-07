"use client";

/**
 * Tiny "tap again to confirm" guard for irreversible actions on valuable gear
 * (rare/epic sell + salvage). Extracted out of `InventoryPanel.tsx`'s
 * `DetailCard` (UAT: ShopPanel's sell tab needs the EXACT same guard
 * semantics per-row) — one hook instance per guarded action, first tap while
 * `needsConfirm` arms it, second tap (or a call with `needsConfirm=false`)
 * fires. No fetch/store coupling here.
 */

import { useState } from "react";

export interface ConfirmGuard {
  confirming: boolean;
  /** Call on tap. Arms (and returns without firing) on the first tap when
   * `needsConfirm` is true; fires `action` and disarms otherwise. */
  trigger: (needsConfirm: boolean, action: () => void) => void;
}

export function useConfirmGuard(): ConfirmGuard {
  const [confirming, setConfirming] = useState(false);

  function trigger(needsConfirm: boolean, action: () => void): void {
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    action();
  }

  return { confirming, trigger };
}
