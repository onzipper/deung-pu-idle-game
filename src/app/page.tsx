import { GameClient } from "@/app/(game)/GameClient";

export default function Home() {
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
