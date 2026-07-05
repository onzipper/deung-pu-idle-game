"use client";

/**
 * Character-creation step (M5 Character Pivot): a class picker that sells
 * the fantasy (3 cards: role tagline + playstyle hint + primary-stat
 * affinity, reusing `HERO_ICONS` + the `content.classes` / `stats` i18n
 * keys already shipped for the in-game HUD) plus a name field with a live
 * client-side mirror of the server's validation rules
 * (`@/ui/characters/validateName` — see that file for why it's a
 * hand-duplicated pure function rather than an import from `@/server/characters`).
 *
 * POST /api/characters is the single source of truth for acceptance (limit/
 * duplicate-name checks are server-side and can race the client's local
 * check) — this component only reduces round-trip 400s and gives instant
 * feedback while typing.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { primaryStat, SLOT_ORDER, type HeroClass } from "@/engine";
import { HERO_ICONS } from "@/ui/labels";
import { validateCharacterName, type NameValidationError } from "@/ui/characters/validateName";
import type { CharacterDTO, CreateCharacterErrorCode } from "@/ui/components/characters/types";

export interface CreateCharacterFormProps {
  onCreated: (character: CharacterDTO) => void;
  onCancel: () => void;
}

function ClassCard({
  cls,
  selected,
  onSelect,
}: {
  cls: HeroClass;
  selected: boolean;
  onSelect: () => void;
}) {
  const tContent = useTranslations("content");
  const tStats = useTranslations("stats");
  const tCreate = useTranslations("characters.create");
  const stat = primaryStat(cls);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-11 flex-col items-start gap-1.5 rounded-(--ddp-radius-md) border px-3 py-3 text-left transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
        selected
          ? "border-emerald-400 bg-emerald-400/10 shadow-[0_0_14px_rgba(52,211,153,0.35)]"
          : "border-ddp-border bg-ddp-panel-strong hover:border-ddp-border-soft"
      }`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className="text-xl leading-none">
          {HERO_ICONS[cls]}
        </span>
        <span className="text-sm font-extrabold text-ddp-ink">{tContent(`classes.${cls}.name`)}</span>
      </span>
      <span className="text-[11px] font-semibold text-ddp-gold-bright">
        {tCreate(`classes.${cls}.tagline`)}
      </span>
      <span className="text-[11px] leading-snug text-ddp-ink-muted">
        {tCreate(`classes.${cls}.playstyle`)}
      </span>
      <span className="mt-0.5 rounded-full border border-ddp-border-soft bg-black/40 px-2 py-0.5 text-[10px] font-bold text-ddp-ink-muted">
        {tCreate("affinityLabel")}: {tStats(`names.${stat}`)} · {tStats(`full.${stat}`)}
      </span>
    </button>
  );
}

export function CreateCharacterForm({ onCreated, onCancel }: CreateCharacterFormProps) {
  const t = useTranslations("characters");
  const tCreate = useTranslations("characters.create");

  const [selectedClass, setSelectedClass] = useState<HeroClass | null>(null);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = validateCharacterName(name);
  const showNameError = touched && !validation.ok;

  function nameErrorMessage(error: NameValidationError): string {
    return tCreate(`nameError.${error}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (!selectedClass || !validation.ok) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: validation.trimmed, baseClass: selectedClass }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (res.ok && data && typeof data === "object" && "character" in data) {
        onCreated((data as { character: CharacterDTO }).character);
        return;
      }

      const code =
        data && typeof data === "object" && "code" in data
          ? ((data as { code?: CreateCharacterErrorCode }).code ?? null)
          : null;
      if (code === "limit") setServerError(tCreate("limitError"));
      else if (code === "duplicate") setServerError(tCreate("duplicateError"));
      else setServerError(tCreate("genericError"));
    } catch {
      setServerError(tCreate("genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-4 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 shadow-(--ddp-shadow-panel)"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-extrabold text-ddp-gold-bright">{tCreate("title")}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
        >
          {t("backToRosterButton")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
          {tCreate("classPickerLabel")}
        </span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SLOT_ORDER.map((cls) => (
            <ClassCard
              key={cls}
              cls={cls}
              selected={selectedClass === cls}
              onSelect={() => setSelectedClass(cls)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="character-name" className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
          {tCreate("nameLabel")}
        </label>
        <input
          id="character-name"
          type="text"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={tCreate("namePlaceholder")}
          className={`min-h-11 rounded-(--ddp-radius-md) border bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none placeholder:text-ddp-ink-muted/60 ${
            showNameError ? "border-ddp-bad" : "border-ddp-border-soft focus:border-emerald-400"
          }`}
        />
        {showNameError && validation.error ? (
          <span className="text-[11px] font-semibold text-ddp-bad">
            {nameErrorMessage(validation.error)}
          </span>
        ) : (
          <span className="text-[11px] text-ddp-ink-muted">{tCreate("nameHint")}</span>
        )}
      </div>

      {serverError && (
        <span className="rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-2 text-[12px] font-semibold text-ddp-bad">
          {serverError}
        </span>
      )}

      <button
        type="submit"
        disabled={submitting || !selectedClass || !validation.ok}
        className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2.5 text-sm font-extrabold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
          submitting || !selectedClass || !validation.ok
            ? "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
            : "border-emerald-400 bg-emerald-400 text-emerald-950"
        }`}
      >
        {submitting ? tCreate("submitting") : tCreate("submitButton")}
      </button>
    </form>
  );
}
