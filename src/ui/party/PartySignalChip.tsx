"use client";

/**
 * M8 party Wave 3 "ตัวบอกสถานะปาร์ตี้" (docs/ghost-presence-design.md) — replaces the
 * old always-visible `CohortStatus` text strip with a compact signal-bar chip, mirroring
 * `BuffBadgeHub.tsx`'s top-left placement on the OPPOSITE corner (`top-[14%] right-2`,
 * clears the boss/world-boss HP bar the same way BuffBadgeHub's own comment explains).
 * Presentational only: ALL connect/handshake/turn-buffering state lives in
 * `app/(game)/partySession.ts`/`cohortTurnEngine.ts` (owned by `GameClient.tsx`), which
 * push `cohortStatus` (chip visibility/pulsing) and `cohortNet` (RTT + per-member lag,
 * ~1Hz) into the store. Renders NOTHING while `cohortStatus.kind === "solo"` (not in a
 * party, or alone in my zone) — the overwhelming common case, zero HUD footprint.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { rttTone, signalChipView, type SignalTone } from "@/ui/party/signalChip";
import { useGameStore } from "@/ui/store/gameStore";

/** Mirrors `engine/lockstep`'s `TURN_MS` (100ms/turn) as a plain display constant — the
 *  ui/ layer reaches the engine ONLY through `@/engine`'s barrel (which doesn't
 *  re-export lockstep internals), and this one number is stable/unlikely to drift
 *  unnoticed (a lockstep cadence change is a whole-system event, not a quiet tweak). */
const TURN_MS_DISPLAY = 100;

const BAR_BG: Record<SignalTone, string> = {
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  gray: "bg-ddp-ink-muted/60",
};

const CHIP_TONE: Record<SignalTone, string> = {
  emerald: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  rose: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  gray: "border-ddp-border-soft bg-black/25 text-ddp-ink-muted",
};

const TEXT_TONE: Record<SignalTone, string> = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  rose: "text-rose-300",
  gray: "text-ddp-ink-muted",
};

function SignalBars({ lit, tone, pulsing }: { lit: number; tone: SignalTone; pulsing: boolean }) {
  return (
    <span aria-hidden className={`flex items-end gap-[2px] ${pulsing ? "animate-pulse" : ""}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-[1px] ${i < lit ? BAR_BG[tone] : "bg-white/15"}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </span>
  );
}

export function PartySignalChip() {
  const t = useTranslations("partyCohort");
  const status = useGameStore((s) => s.cohortStatus);
  const net = useGameStore((s) => s.cohortNet);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const view = signalChipView(status, net.rttMs);
  if (!view) return null;

  const memberCount = net.perMember.length + 1;
  const waitingMember =
    status.kind === "waiting" && net.waitingOnSlot !== null
      ? (net.perMember.find((m) => m.slot === net.waitingOnSlot) ?? null)
      : null;

  return (
    <div ref={rootRef} className="pointer-events-auto absolute top-[14%] right-2 z-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("signalChipLabel")}
        className={`flex items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-bold shadow-(--ddp-shadow-panel) transition-transform duration-100 active:scale-95 ${CHIP_TONE[view.tone]}`}
      >
        <SignalBars lit={view.bars} tone={view.tone} pulsing={view.pulsing} />
        <span className="tabular-nums">{memberCount}</span>
        {waitingMember?.name && (
          <span className="max-w-8 truncate text-[10px] opacity-80">{waitingMember.name}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("signalPopoverTitle")}
          className="absolute top-full right-0 z-20 mt-1.5 w-56 max-w-[78vw] rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2.5 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
        >
          <div className="mb-1.5 font-bold text-ddp-gold-bright">{t("signalPopoverTitle")}</div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-ddp-ink-muted">{t("signalRelayRow")}</span>
            <span className={`font-bold tabular-nums ${TEXT_TONE[rttTone(net.rttMs)]}`}>
              {net.rttMs === null ? "…" : `${Math.round(net.rttMs)}ms`}
            </span>
          </div>
          {net.perMember.length === 0 ? (
            <div className="text-ddp-ink-muted">{t("signalNoMembers")}</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {net.perMember.map((m) => {
                const ms = m.lagTurns * TURN_MS_DISPLAY;
                return (
                  <li key={m.slot} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {m.name ?? t("signalUnknownMember")}
                      {m.shadowed ? ` (${t("signalShadowed")})` : ""}
                    </span>
                    <span className={`shrink-0 font-bold tabular-nums ${TEXT_TONE[rttTone(ms)]}`}>
                      {Math.round(ms)}ms
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
