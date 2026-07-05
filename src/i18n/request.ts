/**
 * next-intl request configuration — resolves the locale + messages for the
 * current request. Loaded by the `next-intl/plugin` wiring in
 * `next.config.ts` (default path: `./src/i18n/request.ts`).
 *
 * COOKIE-BASED, NOT ROUTING-BASED: there is intentionally no `[locale]` URL
 * segment and no `proxy.ts`/middleware. This game mounts `GameClient` (the
 * rAF loop + Pixi `Application`, engine state held in a closure) once at the
 * page root; a routing-based locale segment would put that component under
 * a dynamic route segment that Next.js can remount on a locale change,
 * which would kill the closure-held engine/render state. Reading the
 * locale from a plain cookie instead keeps the route tree — and
 * `GameClient`'s mount point — completely stable. Switching locale
 * (`src/ui/components/LocaleSwitch.tsx`) only writes this cookie and calls
 * `router.refresh()`, which re-renders Server Components and merges the
 * updated RSC payload into the existing client tree without unmounting any
 * client component (see Next.js `useRouter().refresh()` docs).
 */

import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isAppLocale, LOCALE_COOKIE_NAME } from "@/i18n/config";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isAppLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
