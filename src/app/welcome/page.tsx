import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WelcomeScreen } from "@/ui/components/welcome/WelcomeScreen";

/**
 * Entry screen (M8 Phase 0) — three lanes for a fresh visitor: guest
 * ("เล่นเลย", zero-friction), login, register. Reachable regardless of
 * cookie state (an existing guest/account can land here deliberately via
 * the "log in with another account" link in Settings → My Account), so this
 * route intentionally carries NO server-side gate — see
 * `src/app/characterGate.ts` for where the *redirect-here* decision lives
 * (brand-new visitor with no identity cookie at all).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.welcome");
  return { title: t("title") };
}

export default function WelcomePage() {
  return (
    <main className="flex flex-1 flex-col items-center">
      <WelcomeScreen />
    </main>
  );
}
