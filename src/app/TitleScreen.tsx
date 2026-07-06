import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Title/landing screen (M6.5b UI Skin, wave 1 — task 86d3k2skin).
 *
 * Shown ONLY to a genuinely brand-new visitor (no identity cookie at all —
 * see `isBrandNewVisitor()` in `characterGate.ts`); a returning visitor
 * without a resolvable active character skips straight to `/characters` as
 * before (unchanged behavior). This keeps the character-select screen
 * completely untouched — this file is the only new surface for wave 1.
 *
 * Server Component: the only interactivity is a plain `<Link>` navigation to
 * `/characters`, so no client JS is needed. All ambience (sky gradient,
 * drifting motes, rolling-hills silhouette, breathing glows) is CSS-only —
 * see the `.ddp-title-*` rules in `globals.css` — no image assets, no
 * hand-built canvas gradients (that rule is Pixi/canvas-2D specific; this is
 * plain CSS text/background, a different surface entirely).
 */
export async function TitleScreen() {
  const t = await getTranslations("title");

  return (
    <div className="ddp-title-screen flex w-full flex-1 flex-col items-center justify-center px-6 py-10 text-center sm:py-16">
      <div className="ddp-title-sky" aria-hidden />
      <div className="ddp-title-motes" aria-hidden />
      <div className="ddp-title-hills" aria-hidden />

      <div className="ddp-title-content flex flex-col items-center">
        <div className="ddp-title-card">
          <div className="ddp-title-crest" aria-hidden>
            <span className="ddp-title-crest-facet ddp-title-crest-facet--sword" />
            <span className="ddp-title-crest-facet ddp-title-crest-facet--bow" />
            <span className="ddp-title-crest-facet ddp-title-crest-facet--magic" />
          </div>

          <h1 className="ddp-title-logo">ดึ๋งปุ๊</h1>

          <p className="ddp-title-tagline">{t("tagline")}</p>

          <Link href="/characters" className="ddp-title-cta">
            <span>{t("ctaButton")}</span>
          </Link>
        </div>

        <p className="ddp-title-footnote mt-8">{t("footerNote")}</p>
      </div>
    </div>
  );
}
