/**
 * Shared i18n constants.
 *
 * Deliberately plain data — no `next/headers`, no React, no `next-intl`
 * server-only imports — so this file is safe to import from BOTH sides of
 * the RSC boundary: the server-only request config (`./request.ts`) and
 * client components like `src/ui/components/LocaleSwitch.tsx`.
 */

export const locales = ["th", "en"] as const;

export type AppLocale = (typeof locales)[number];

/** ดึ๋งปุ๊ ships Thai-first; `en` is the secondary/opt-in locale. */
export const defaultLocale: AppLocale = "th";

/**
 * Cookie the client-side locale switch writes (`document.cookie`, no
 * server round-trip needed — see `LocaleSwitch.tsx`) and `request.ts` reads
 * server-side to pick the locale for the initial render. Deliberately NOT
 * httpOnly: this is a UI preference (like `soundMuted`'s localStorage key),
 * not anything security-sensitive, so a client-set cookie is fine.
 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export function isAppLocale(value: string | undefined): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value);
}
