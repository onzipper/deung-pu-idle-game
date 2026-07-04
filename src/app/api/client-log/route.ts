/**
 * DEV-ONLY diagnostics: client error/log beacon sink.
 *
 * Accepts POSTs from the inline boot-error beacon (src/app/layout.tsx) and the
 * dev-only hydration ping (src/app/(game)/GameClient.tsx) and just
 * console.log's them so a device we can't plug DevTools into (e.g. a phone)
 * can still report what happened, in the dev server's own terminal output.
 *
 * Development-only: in production this route 404s and logs nothing. No DB,
 * no validation strictness — this is a throwaway debugging tool, not a
 * feature. Safe to delete this whole file (and its callers) once the mobile
 * hydration bug is diagnosed.
 */

import { NextResponse } from "next/server";

// Never statically optimized — always run per-request.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse leniently: sendBeacon/fetch keepalive bodies aren't guaranteed to be
  // well-formed JSON (e.g. truncated on page unload), so fall back to raw text.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    try {
      payload = await request.text();
    } catch {
      payload = "<unreadable body>";
    }
  }

  console.log("[CLIENT-LOG]", JSON.stringify(payload));

  return NextResponse.json({ ok: true });
}
