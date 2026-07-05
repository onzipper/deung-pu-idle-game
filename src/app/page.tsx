import { redirect } from "next/navigation";
import { GameClient } from "@/app/(game)/GameClient";
import { hasResolvableActiveCharacter } from "@/app/characterGate";

export default async function Home() {
  // M5 Character Pivot: the game is now per-character. Gate the whole page
  // server-side (before GameClient ever mounts) — see characterGate.ts for
  // why this reads cookies directly instead of calling the identity/active-
  // character server helpers (which may try to WRITE a cookie, unsupported
  // during a plain page render).
  if (!(await hasResolvableActiveCharacter())) {
    redirect("/characters");
  }

  return (
    // Top-aligned (not vertically centered): on a short mobile-portrait
    // viewport the dock can legitimately run past the fold — this lets the
    // page scroll vertically instead of squeezing/cropping the arena.
    // Horizontal scroll is still disallowed (see globals.css body overflow-x).
    <main className="flex flex-1 flex-col items-center">
      <GameClient />
    </main>
  );
}
