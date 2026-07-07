import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasIdentityCookie } from "@/app/characterGate";
import { CharactersScreen } from "@/ui/components/characters/CharactersScreen";

/**
 * Character roster / creation route (M5 Character Pivot).
 *
 * Server Component shell only — all interactivity (fetching the roster,
 * create/select/delete) lives in the client component below, which talks to
 * the already-live `/api/characters*` endpoints (see docs/persistence-m5.md).
 * This route needs no *character* gate: it's always safe to land here (0, 1,
 * 2, or 3 live characters), unlike the game page which requires a resolvable
 * active character (see `src/app/characterGate.ts`). It DOES gate on having
 * an identity cookie at all (M8 Phase 0) — a cookie-less deep link bounces
 * to `/welcome` to pick a lane first, instead of hitting the roster API with
 * no account behind it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("characters");
  return { title: t("pageTitle") };
}

export default async function CharactersPage() {
  if (!(await hasIdentityCookie())) {
    redirect("/welcome");
  }

  return (
    <main className="flex flex-1 flex-col items-center">
      <CharactersScreen />
    </main>
  );
}
