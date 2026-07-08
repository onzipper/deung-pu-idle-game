"use client";

/**
 * "ตำราตำนาน" secret-quest CELEBRATORY reveal (endgame v1.3) — fires once, the
 * instant the 3rd tome page lands (the `tomeAssembled` engine event flips
 * `tomeAssembledCelebration` in `GameClient.tsx`). Same modal shell convention
 * as `PatchNotesModal.tsx` (fixed overlay, sim never pauses behind it,
 * intentionally NO backdrop-click-to-dismiss — a one-time announcement the
 * player should actively acknowledge). Mounted once at the top level
 * (`GameClient.tsx`, a sibling of `GameHud`), same as `PatchNotesModal`.
 */

import { useTranslations } from "next-intl";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { useGameStore } from "@/ui/store/gameStore";

export function AsuraTomeAssembledModal() {
  const show = useGameStore((s) => s.tomeAssembledCelebration);
  const dismiss = useGameStore((s) => s.dismissTomeAssembledCelebration);
  const t = useTranslations("asura.tome.assembled");

  if (!show) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
      >
        <div className="absolute inset-0 bg-black/80" />
        <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-(--ddp-radius-lg) border border-fuchsia-400/50 bg-ddp-panel-strong p-4 text-ddp-ink shadow-[0_0_40px_8px_rgba(217,70,239,0.25)]">
          <h2 className="bg-gradient-to-r from-ddp-gold-bright via-fuchsia-300 to-violet-400 bg-clip-text text-lg font-black text-transparent">
            {t("title")}
          </h2>

          <ul className="flex-1 space-y-2.5 overflow-y-auto pr-1 text-sm leading-snug text-ddp-ink">
            {(["line1", "line2", "line3", "line4"] as const).map((key) => (
              <li key={key} className="rounded-(--ddp-radius-md) bg-black/25 p-2.5">
                {t(key)}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 rounded-(--ddp-radius-md) border border-fuchsia-400/70 bg-fuchsia-400/15 px-3 text-sm font-black text-fuchsia-200 shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.97]"
          >
            {t("ackButton")}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
