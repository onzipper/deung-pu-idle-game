"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a modal confirm dialog (ยกเลิก secondary /
 * ยืนยัน primary gold, `variant="danger"` swaps the confirm button to red).
 * Renders through `ModalPortal` per the house rule (iOS Safari backdrop-filter
 * trap). Presentational + self-contained: caller supplies open state via
 * conditional render and the two callbacks — no store reads.
 *
 * NOTE: this is a distinct pattern from the existing `useConfirmGuard.ts`
 * "tap again to confirm" INLINE button convention used across
 * `InventoryPanel.tsx`/`SellRow.tsx`/`ShopPanel.tsx` — that hook stays
 * unchanged this wave (see R2-W1 report). `ConfirmPopup` is here for surfaces
 * that want a true modal confirmation (bigger/irreversible actions), not a
 * forced replacement of the inline guard everywhere it's used today.
 */

import type { ReactNode } from "react";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";

export interface ConfirmPopupProps {
  title?: ReactNode;
  message: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPopup({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmPopupProps) {
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-80 flex items-center justify-center p-3"
        role="alertdialog"
        aria-modal="true"
      >
        <button type="button" aria-hidden className="absolute inset-0 bg-black/70" onClick={onCancel} />
        <Panel
          variant="gold"
          className="animate-onboarding-in relative flex w-full max-w-sm flex-col gap-3"
        >
          {title && (
            <h3 className="font-display text-sm font-extrabold text-ddp-gold-bright">{title}</h3>
          )}
          <p className="text-sm text-ddp-ink">{message}</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant={variant === "danger" ? "danger" : "primary"} className="flex-1" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Panel>
      </div>
    </ModalPortal>
  );
}
