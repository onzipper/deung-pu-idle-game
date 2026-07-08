"use client";

/**
 * Character rename modal (once per Asia/Bangkok server-day). Same modal
 * vocabulary as `DeleteCharacterDialog` (portaled scrim + centered card) so it
 * reads as part of the same app. Reuses the SAME name-input affordance as
 * creation (2–24 Thai/EN alnum, enforced server-side); the client just bounds
 * the field and surfaces the server's rejection codes (`name_taken`,
 * `rename_cooldown`). On success the parent patches its roster in place.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ModalPortal } from "@/ui/components/ModalPortal";
import type { CharacterDTO } from "@/ui/components/characters/types";

export interface RenameCharacterDialogProps {
  character: CharacterDTO;
  onCancel: () => void;
  onRenamed: (character: CharacterDTO) => void;
}

export function RenameCharacterDialog({
  character,
  onCancel,
  onRenamed,
}: RenameCharacterDialogProps) {
  const t = useTranslations("characters.rename");
  const [name, setName] = useState(character.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSave = trimmed.length >= 2 && trimmed !== character.name && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/characters/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: character.id, name: trimmed }),
      });
      if (res.ok) {
        const data = (await res.json()) as { character: CharacterDTO };
        onRenamed(data.character);
        return;
      }
      const data = (await res.json().catch(() => null)) as { code?: string } | null;
      setError(
        data?.code === "name_taken"
          ? t("nameTaken")
          : data?.code === "rename_cooldown"
            ? t("cooldown")
            : t("error"),
      );
      setSaving(false);
    } catch {
      setError(t("error"));
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
      >
        <button
          type="button"
          aria-label={t("cancelButton")}
          onClick={onCancel}
          className="absolute inset-0 bg-black/70"
        />
        <div className="animate-onboarding-in relative flex w-full max-w-sm flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
          <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>
          <p className="text-[11.5px] leading-snug text-ddp-ink-muted">{t("cooldownHint")}</p>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-ddp-ink-muted">
            {t("label")}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              autoFocus
              placeholder={t("placeholder")}
              className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400/60"
            />
          </label>
          <span className="text-[10.5px] leading-snug text-ddp-ink-muted">{t("hint")}</span>

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
              disabled={!canSave}
              onClick={() => void handleSave()}
              className={`min-h-11 flex-1 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
                canSave
                  ? "border-emerald-400 bg-emerald-400 text-emerald-950"
                  : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
              }`}
            >
              {saving ? t("saving") : t("saveButton")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
