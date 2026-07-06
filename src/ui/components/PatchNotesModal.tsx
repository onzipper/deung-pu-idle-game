"use client";

/**
 * "What's new" patch-notes modal (UAT task) — SAME modal shell convention as
 * `SettingsPanel.tsx`/`RefinePanel.tsx` (fixed overlay, rounded panel, sim
 * never pauses behind it). All decision logic (show/skip/record) lives in
 * `ui/hooks/usePatchNotes.ts` + the pure `ui/patchNotes.ts`; this component
 * only presents the latest release and its single acknowledge button —
 * intentionally NO backdrop-click-to-dismiss and no "X" close button (unlike
 * the other panels), since this is a one-time announcement the player should
 * actively acknowledge, not an ambient settings surface.
 *
 * Mounted once, directly in `GameClient.tsx` (a sibling of `GameHud`) — see
 * that file's doc comment for why it lives at the top level rather than
 * inside `GameHud.tsx` alongside `OnboardingOverlay`/`ContextualTipOverlay`.
 */

import { useTranslations } from "next-intl";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { latestPatchNotes } from "@/ui/patchNotes";
import { usePatchNotes } from "@/ui/hooks/usePatchNotes";

export function PatchNotesModal() {
  const { show, acknowledge } = usePatchNotes();
  const t = useTranslations("patchNotes");

  if (!show) return null;

  const release = latestPatchNotes();

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>

        <ul className="flex-1 space-y-2.5 overflow-y-auto pr-1 text-sm leading-snug text-ddp-ink">
          {release.items.map((key) => (
            <li key={key} className="rounded-(--ddp-radius-md) bg-black/25 p-2.5">
              {t(key)}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={acknowledge}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-gold/70 bg-ddp-gold/20 px-3 text-sm font-black text-ddp-gold-bright shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.97]"
        >
          {t("ackButton")}
        </button>
      </div>
    </div>
    </ModalPortal>
  );
}
