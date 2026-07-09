"use client";

/**
 * R1 "โลกใหม่ หน้าตาใหม่" (W1 design system) — the signature panel shell.
 * Presentational ONLY: no store reads, no game imports, no engine/render
 * coupling. `variant="gold"` is the gold-frame look reserved for TOP-LEVEL
 * panels/modals (fast-travel picker, inventory, settings, …) — nested rows /
 * sub-boxes inside a panel must keep `variant="plain"` (or a bare div using
 * the existing slate `--ddp-border` token) so gold stays special instead of
 * bleeding into every nested box.
 *
 * Callers own layout/sizing (`w-full max-w-md`, `max-h-[85vh]`, flex
 * direction, …) via `className` — this component only owns the frame's
 * color/border/shadow/radius/padding, so it composes cleanly with the fixed
 * `inset-0` modal-overlay wrapper + `ModalPortal` pattern every modal already
 * uses (see `FastTravelPicker.tsx`/`InventoryPanel.tsx`).
 */

import type { HTMLAttributes, ReactNode } from "react";

export type PanelVariant = "gold" | "plain";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
  children: ReactNode;
}

const BASE_CLASS = "rounded-(--ddp-radius-lg) p-4 text-ddp-ink";

const VARIANT_CLASS: Record<PanelVariant, string> = {
  gold: "border border-ddp-gold-border bg-ddp-panel-strong shadow-(--ddp-glow-gold)",
  plain: "border border-ddp-border bg-ddp-panel shadow-(--ddp-shadow-panel)",
};

export function Panel({ variant = "plain", className = "", children, ...rest }: PanelProps) {
  return (
    <div {...rest} className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`}>
      {children}
    </div>
  );
}
