/**
 * Server-side read of the build identifier pinned by `next.config.ts`
 * (`resolveBuildId()` in `@/lib/buildId`) into `process.env.NEXT_PUBLIC_BUILD_ID`.
 * Single source of truth reused by `/api/save`'s GET + POST responses — see
 * that route for the transport (piggybacks the existing autosave cadence, no
 * extra requests) and `src/ui/updateBanner.ts` for the client-side comparison
 * against its own inlined copy of the SAME env var.
 */
export function currentBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
}
