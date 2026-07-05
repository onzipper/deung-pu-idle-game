import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CharactersScreen } from "@/ui/components/characters/CharactersScreen";

/**
 * Character roster / creation route (M5 Character Pivot).
 *
 * Server Component shell only — all interactivity (fetching the roster,
 * create/select/delete) lives in the client component below, which talks to
 * the already-live `/api/characters*` endpoints (see docs/persistence-m5.md).
 * This route itself needs no server-side gate: it's always safe to land
 * here (0, 1, 2, or 3 live characters), unlike the game page which requires
 * a resolvable active character (see `src/app/characterGate.ts`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("characters");
  return { title: t("pageTitle") };
}

export default function CharactersPage() {
  return (
    <main className="flex flex-1 flex-col items-center">
      <CharactersScreen />
    </main>
  );
}
