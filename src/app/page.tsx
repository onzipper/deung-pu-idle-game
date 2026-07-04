import { GameClient } from "@/app/(game)/GameClient";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-950 p-4">
      <GameClient />
    </main>
  );
}
