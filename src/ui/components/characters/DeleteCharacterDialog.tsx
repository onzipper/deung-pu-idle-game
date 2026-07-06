"use client";

/**
 * Destructive-action confirmation for character deletion (M5 Character Pivot).
 * Type-the-name-to-confirm (not a two-tap) — deleting a character permanently
 * loses its save (server keeps the row for audit only, see
 * docs/persistence-m5.md, but the player never gets it back through the UI),
 * so the bar for confirming is higher than the in-game "tap again" evolve
 * pattern. Same modal vocabulary as `CodexPanel` (full-screen scrim + centered
 * card) so it reads as part of the same app rather than a native `confirm()`.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ModalPortal } from "@/ui/components/ModalPortal";
import type { CharacterDTO } from "@/ui/components/characters/types";

export interface DeleteCharacterDialogProps {
  character: CharacterDTO;
  onCancel: () => void;
  onDeleted: (characterId: string) => void;
}

export function DeleteCharacterDialog({ character, onCancel, onDeleted }: DeleteCharacterDialogProps) {
  const t = useTranslations("characters.delete");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = typed.trim() === character.name && !deleting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("error"));
        setDeleting(false);
        return;
      }
      onDeleted(character.id);
    } catch {
      setError(t("error"));
      setDeleting(false);
    }
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title", { name: character.name })}
    >
      <button
        type="button"
        aria-label={t("cancelButton")}
        onClick={onCancel}
        className="absolute inset-0 bg-black/70"
      />
      <div className="animate-onboarding-in relative flex w-full max-w-sm flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-bad/60 bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <h2 className="text-base font-extrabold text-ddp-bad">{t("title", { name: character.name })}</h2>
        <p className="text-[12.5px] leading-snug text-ddp-ink-muted">{t("warning")}</p>
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-ddp-ink-muted">
          {t("confirmInstruction", { name: character.name })}
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t("confirmPlaceholder")}
            autoFocus
            className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-ddp-bad"
          />
        </label>

        {error && <span className="text-[11px] font-semibold text-ddp-bad">{error}</span>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-3 py-2 text-xs font-bold text-ddp-ink-muted hover:text-ddp-ink"
          >
            {t("cancelButton")}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className={`min-h-11 flex-1 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
              canConfirm
                ? "border-ddp-bad bg-ddp-bad text-white"
                : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
            }`}
          >
            {deleting ? t("deleting") : t("confirmButton")}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
