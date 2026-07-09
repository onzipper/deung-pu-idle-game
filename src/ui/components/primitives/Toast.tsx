"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a single toast line (success/info/danger),
 * matching the mockup's toast samples (icon + text + optional ✕). Purely
 * presentational: no timer, no store reads, no positioning/stacking — callers
 * (e.g. `NoticeToast.tsx`, `DropFeed.tsx`) own the fixed-position stack + the
 * auto-dismiss timer, this component only owns the pill's skin.
 *
 * `onDismiss` is optional — when omitted the toast stays `pointer-events-none`
 * (matches the existing auto-dismiss-only notices, which must never intercept
 * taps on the game canvas underneath them).
 */

import type { ReactNode } from "react";

export type ToastVariant = "success" | "info" | "danger";

export interface ToastProps {
  variant?: ToastVariant;
  icon?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  dismissAriaLabel?: string;
  className?: string;
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: "border-emerald-400/50 bg-emerald-950/85 text-emerald-100",
  info: "border-violet-400/40 bg-violet-950/85 text-ddp-ink",
  danger: "border-ddp-bad/60 bg-red-950/85 text-rose-100",
};

export function Toast({
  variant = "info",
  icon,
  children,
  onDismiss,
  dismissAriaLabel = "dismiss",
  className = "",
}: ToastProps) {
  return (
    <div
      role="status"
      className={`animate-buy-pulse flex items-center gap-2 rounded-(--ddp-radius-md) border px-3 py-1.5 text-xs font-bold shadow-(--ddp-shadow-btn) ${
        onDismiss ? "pointer-events-auto" : "pointer-events-none"
      } ${VARIANT_CLASS[variant]} ${className}`}
    >
      {icon && (
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissAriaLabel}
          className="shrink-0 rounded-(--ddp-radius-sm) px-1 text-ddp-ink-muted transition-colors hover:text-ddp-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
}
