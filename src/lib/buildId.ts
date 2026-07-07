import { execSync } from "node:child_process";

/**
 * Build identifier used by the mid-session "new patch deployed" banner
 * (owner-approved feature). Resolved ONCE, synchronously, from
 * `next.config.ts`'s module scope — that file assigns the result into
 * `process.env.NEXT_PUBLIC_BUILD_ID` BEFORE Next reads env vars for both:
 *  - webpack's `DefinePlugin` inlining (client bundle), and
 *  - the server process's own `process.env` (route handlers read it directly,
 *    see `@/server/buildId`).
 *
 * Fallback chain (first that resolves wins):
 *  1. `NEXT_PUBLIC_BUILD_ID` already set in the environment (CI/deploy
 *     pipeline pins it explicitly — the airtight option, recommended for
 *     production so client/server never depend on git being present).
 *  2. `git rev-parse --short HEAD` — the UAT box always builds with git
 *     available (see CLAUDE.md), so this is the common real-world path; a
 *     normal build-then-start deploy checks out the same commit for both
 *     `next build` and `next start`, so both processes resolve the SAME sha.
 *  3. A build-timestamp fallback (base36) — last resort if git is entirely
 *     unavailable. CAVEAT: `next.config.ts` is re-evaluated by `next start`
 *     as a separate process from `next build`, so this branch can disagree
 *     between the two (a false-positive "update available" banner on first
 *     load). Acceptable degraded behavior for a case that shouldn't occur on
 *     the real deploy target; prefer branch 1 if it ever does.
 */
export function resolveBuildId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BUILD_ID;
  if (fromEnv) return fromEnv;

  try {
    const sha = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    /* git unavailable / not a repo checkout — fall through to the timestamp */
  }

  return Date.now().toString(36);
}
