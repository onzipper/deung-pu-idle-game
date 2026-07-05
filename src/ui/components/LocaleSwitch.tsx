"use client";

/**
 * ไทย / EN locale switch.
 *
 * Cookie-based, NOT a `[locale]` URL segment (see `src/i18n/request.ts`) —
 * switching only writes `LOCALE_COOKIE_NAME` and calls `router.refresh()`,
 * which re-renders Server Components and merges the updated RSC payload
 * into the existing client tree WITHOUT unmounting any client component
 * (Next.js `useRouter().refresh()` docs). `GameClient`'s rAF loop / Pixi
 * `Application` (held in a closure, mounted once at the page root) is
 * therefore untouched by a locale switch.
 *
 * Labels are plain text ("ไทย"/"EN"), not flag emoji, to match the rest of
 * the HUD's typography (and sidestep the Windows-10 emoji-glyph footgun
 * entirely — see CLAUDE.md). Button text comes from `settings.localeTh` /
 * `settings.localeEn` — always the plain language name in its OWN language
 * (never translated per the active locale), so it stays a stable index of
 * available languages regardless of which one is currently selected.
 */

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE_NAME, locales, type AppLocale } from "@/i18n/config";

/**
 * Plain module-level helper (not inline in the component) so the
 * `document.cookie` write reads as an explicit, isolated side effect rather
 * than an in-render/in-hook mutation of an outside-scope value — keeps the
 * React Compiler's ESLint immutability check happy the same way
 * `gameStore.ts`'s `writeSoundMuted()` isolates its `localStorage` write.
 * Client-set is fine (not security-sensitive); a year-long expiry keeps the
 * preference across sessions.
 */
function setLocaleCookie(next: AppLocale): void {
  document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=31536000; samesite=lax`;
}

export function LocaleSwitch() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("settings");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: AppLocale): void {
    if (next === locale || isPending) return;
    // `router.refresh()` re-resolves `src/i18n/request.ts` server-side
    // against the new cookie value.
    setLocaleCookie(next);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("localeLabel")}
      </span>
      <div className="flex gap-1 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-1 shadow-(--ddp-shadow-btn)">
        {locales.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => switchTo(l)}
            aria-pressed={locale === l}
            disabled={isPending}
            className={`min-h-11 min-w-11 rounded-[calc(var(--ddp-radius-md)-0.25rem)] px-3 py-1.5 text-sm font-bold transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] disabled:opacity-60 ${
              locale === l
                ? "bg-emerald-400 text-emerald-950 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                : "bg-transparent text-ddp-ink-muted hover:text-ddp-ink"
            }`}
          >
            {l === "th" ? t("localeTh") : t("localeEn")}
          </button>
        ))}
      </div>
    </div>
  );
}
