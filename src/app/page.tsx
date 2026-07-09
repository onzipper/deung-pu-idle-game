import { redirect } from "next/navigation";
import { GameClient } from "@/app/(game)/GameClient";
import { hasIdentityCookie, hasResolvableActiveCharacter } from "@/app/characterGate";

export default async function Home() {
  // M5 Character Pivot: the game is now per-character. Gate the whole page
  // server-side (before GameClient ever mounts) — see characterGate.ts for
  // why this reads cookies directly instead of calling the identity/active-
  // character server helpers (which may try to WRITE a cookie, unsupported
  // during a plain page render).
  if (!(await hasResolvableActiveCharacter())) {
    // M8 Phase 0: a brand-new visitor (no identity cookie at all) picks a
    // lane on /welcome (guest/login/register) instead of landing directly on
    // the character roster; an existing guest/account with 0 resolvable
    // characters keeps today's behavior exactly.
    redirect((await hasIdentityCookie()) ? "/characters" : "/welcome");
  }

  return (
    // R2-W2 "fullscreen HUD": the game screen is now a fullscreen canvas with
    // every HUD element as an absolute overlay on top of it (see
    // `GameHud.tsx`'s doc) — no more boxed arena + scrollable in-flow dock
    // below it, so the page itself never scrolls (`h-dvh` = the dynamic
    // viewport height, correct on mobile browsers whose chrome show/hides).
    <main className="h-dvh overflow-hidden">
      <GameClient />
    </main>
  );
}
