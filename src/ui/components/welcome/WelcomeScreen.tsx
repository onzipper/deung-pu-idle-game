"use client";

/**
 * Entry screen (M8 Phase 0 — owner spec): three lanes for a fresh visitor.
 *  - "เล่นเลย" (guest): zero-friction primary CTA, mints the anonymous
 *    identity cookie via `POST /api/auth/guest` and drops straight into
 *    `/characters` — no form, matches today's anonymous flow exactly.
 *  - Login / Register: a segmented toggle switches between the two forms
 *    (`LoginForm` / `RegisterForm`); kept as two lightweight lanes rather
 *    than one combined form since their server contracts and success
 *    behavior differ (hard navigate vs. `router.push`).
 *
 * Mobile-first (big thumb-reach buttons, single column) but unconstrained
 * width-wise so it reads fine centered on desktop too (owner directive:
 * both device classes are first-class).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoginForm } from "@/ui/components/welcome/LoginForm";
import { RegisterForm } from "@/ui/components/welcome/RegisterForm";

type FormLane = "login" | "register";

export function WelcomeScreen() {
  const t = useTranslations("auth.welcome");
  const router = useRouter();

  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [lane, setLane] = useState<FormLane>("login");

  async function handleGuest() {
    setGuestError(null);
    setGuestLoading(true);
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) throw new Error("guest entry failed");
      router.push("/characters");
    } catch {
      setGuestError(t("guestError"));
      setGuestLoading(false);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-1 flex-col gap-4 px-3 py-8 sm:px-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-extrabold text-ddp-gold-bright">{t("title")}</h1>
        <p className="text-[13px] text-ddp-ink-muted">{t("subtitle")}</p>
      </div>

      <button
        type="button"
        onClick={() => void handleGuest()}
        disabled={guestLoading}
        className="min-h-14 rounded-(--ddp-radius-lg) border border-emerald-400 bg-emerald-400 px-4 py-3 text-base font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {guestLoading ? t("guestLoading") : t("guestButton")}
      </button>
      {guestError && (
        <span className="text-center text-[12px] font-semibold text-ddp-bad">{guestError}</span>
      )}
      <p className="text-center text-[11px] leading-snug text-ddp-ink-muted">{t("guestHint")}</p>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-ddp-border-soft" />
        <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
          {t("dividerLabel")}
        </span>
        <div className="h-px flex-1 bg-ddp-border-soft" />
      </div>

      <div className="flex rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 p-1">
        <button
          type="button"
          onClick={() => setLane("login")}
          aria-pressed={lane === "login"}
          className={`min-h-11 flex-1 rounded-(--ddp-radius-md) px-3 py-2 text-xs font-bold transition-colors ${
            lane === "login" ? "bg-ddp-panel-strong text-ddp-ink" : "text-ddp-ink-muted"
          }`}
        >
          {t("loginTab")}
        </button>
        <button
          type="button"
          onClick={() => setLane("register")}
          aria-pressed={lane === "register"}
          className={`min-h-11 flex-1 rounded-(--ddp-radius-md) px-3 py-2 text-xs font-bold transition-colors ${
            lane === "register" ? "bg-ddp-panel-strong text-ddp-ink" : "text-ddp-ink-muted"
          }`}
        >
          {t("registerTab")}
        </button>
      </div>

      {lane === "login" ? (
        <LoginForm />
      ) : (
        <RegisterForm onSuccess={() => router.push("/characters")} />
      )}
    </div>
  );
}
