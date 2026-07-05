import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Cookie-based i18n (no `[locale]` route segment — see `src/i18n/request.ts`),
// so this only needs to point the plugin at the request-config module; no
// routing/pathnames config here.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
