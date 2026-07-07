"use client";

/**
 * Email/password(+displayName) registration form (M8 Phase 0). Reused in two
 * contexts with different post-success behavior, so it takes an `onSuccess`
 * callback rather than hardcoding navigation:
 *  - `/welcome` register lane: `onSuccess` routes to `/characters`.
 *  - Settings → My Account (guest upgrade): `onSuccess` re-fetches
 *    `GET /api/auth/me` to flip the section into its registered state.
 *
 * `POST /api/auth/register` claims the account layer on the CURRENT identity
 * cookie's user row (guest -> account IN PLACE, so saves/characters
 * survive) — see `src/server/auth.ts`.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

export interface RegisterFormProps {
  onSuccess: () => void;
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const t = useTranslations("auth.register");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      if (res.status === 201) {
        onSuccess();
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const code =
        data && typeof data === "object" && "code" in data
          ? (data as { code?: string }).code
          : null;
      if (code === "email_taken") setError(t("emailTaken"));
      else if (code === "already_registered") setError(t("alreadyRegistered"));
      else setError(t("genericError"));
      setSubmitting(false);
    } catch {
      setError(t("genericError"));
      setSubmitting(false);
    }
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4"
    >
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-ddp-ink-muted">
        {t("emailLabel")}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-ddp-ink-muted">
        {t("passwordLabel")}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={t("passwordPlaceholder")}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-ddp-ink-muted">
        {t("displayNameLabel")}
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={24}
          autoComplete="nickname"
          placeholder={t("displayNamePlaceholder")}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400"
        />
        <span className="text-[10px] font-normal text-ddp-ink-muted/80">{t("displayNameHint")}</span>
      </label>

      {error && (
        <span className="rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-2 text-[12px] font-semibold text-ddp-bad">
          {error}
        </span>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2.5 text-sm font-extrabold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
          canSubmit
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
        }`}
      >
        {submitting ? t("submitting") : t("submitButton")}
      </button>
    </form>
  );
}
