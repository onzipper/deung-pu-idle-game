import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolveBuildId } from "./src/lib/buildId";

// Cookie-based i18n (no `[locale]` route segment — see `src/i18n/request.ts`),
// so this only needs to point the plugin at the request-config module; no
// routing/pathnames config here.
const withNextIntl = createNextIntlPlugin();

// Mid-session "new patch deployed" banner (owner-approved feature): resolve +
// pin `NEXT_PUBLIC_BUILD_ID` HERE, at config-module-load time, BEFORE Next
// reads env vars for webpack's client-bundle inlining. This is what makes the
// SAME value land in both places: inlined into the client JS (build time) and
// readable server-side via `process.env.NEXT_PUBLIC_BUILD_ID` at runtime (see
// `@/server/buildId`) — both `next build` and `next start` load this config
// module, and `resolveBuildId()`'s git-sha branch resolves identically for
// both as long as they check out the same commit (true for a normal
// build-then-start deploy). See `src/lib/buildId.ts` for the full fallback
// chain + its caveats.
process.env.NEXT_PUBLIC_BUILD_ID = resolveBuildId();

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
