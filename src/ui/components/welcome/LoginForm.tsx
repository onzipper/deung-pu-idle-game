"use client";

/**
 * Email/password login form (M8 Phase 0 welcome screen — /welcome only; not
 * reused in Settings, which links back here instead of embedding a second
 * copy). On success the caller must HARD-navigate ("/") rather than
 * `router.push` — `POST /api/auth/login` repoints the `dpu_uid` identity
 * cookie and clears `activeCharacterId`, and the game page's server-side
 * gate (`src/app/characterGate.ts`) needs a fresh request to re-resolve
 * against that, not stale client-side RSC state.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

export function LoginForm() {
  const t = useTranslations("auth.login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const code =
        data && typeof data === "object" && "code" in data
          ? (data as { code?: string }).code
          : null;
      setError(code === "bad_credentials" ? t("badCredentials") : t("genericError"));
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
          autoComplete="current-password"
          placeholder={t("passwordPlaceholder")}
          className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400"
        />
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
