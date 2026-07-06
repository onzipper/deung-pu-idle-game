"use client";

/**
 * The Codex/Guide modal ("เปิดดูย้อนได้" — task M4.8): a reference the player
 * can reopen anytime from the settings row (`CodexButton`), unlike the
 * one-shot FTUE overlay. Pure React/CSS over the canvas, same z-layer
 * vocabulary as `OnboardingOverlay` — the sim behind it is never paused
 * (idle game rule) and this component never touches `engine/`/`render/`.
 *
 * Content is entirely data-driven from `./entries.ts`'s `CODEX_CATEGORIES` /
 * `CODEX_ENTRIES` registry; this component only resolves each entry's
 * display strings (content-namespace reuse for `contentRef` entries, or
 * plain `codex.entries.<id>.*` copy otherwise) and renders them grouped by
 * category. Adding M5+ topics (quests) never touches this file — only the
 * registry + message keys.
 *
 * The ONE exception is the "gear" category's COLLECTION GRID (M7 Gear &
 * Drops): all 27 `ITEM_TEMPLATES` catalog entries, rendered directly off
 * engine config rather than `CODEX_ENTRIES` (structured slot/tier/rarity/stat
 * data, not freeform copy — see `entries.ts`'s doc on the `gear` entry).
 * Undiscovered templates render silhouetted/dimmed until first owned; the
 * "discovered" set is a v1 DERIVED read of the current `inventory` store
 * slice (not a persisted ever-owned ledger — a future trade/consume path
 * could re-hide an item, acceptable tradeoff until then, see
 * `gear/inventoryOps.ts`'s `discoveredTemplateIds` doc).
 */

import { useTranslations } from "next-intl";
import { ITEM_TEMPLATES, type ItemTemplate } from "@/engine";
import {
  CODEX_CATEGORIES,
  codexEntriesByCategory,
  type CodexEntryDef,
} from "@/ui/codex/entries";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { discoveredTemplateIds } from "@/ui/gear/inventoryOps";
import { GEAR_SLOT_ICONS, HERO_ICONS, RARITY_COLORS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

const GEAR_TEMPLATES: readonly ItemTemplate[] = Object.values(ITEM_TEMPLATES);

function GearCollectionCard({
  template,
  discovered,
}: {
  template: ItemTemplate;
  discovered: boolean;
}) {
  const tContent = useTranslations("content.items");
  const t = useTranslations("codex");
  const colors = RARITY_COLORS[template.rarity];

  if (!discovered) {
    return (
      <div className="flex flex-col items-center gap-0.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2 py-2 text-center opacity-40 grayscale">
        <span aria-hidden className="text-base">
          {GEAR_SLOT_ICONS[template.slot]}
        </span>
        <span className="text-[10px] font-bold text-ddp-ink-muted">
          {t("gear.undiscovered")}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center gap-0.5 rounded-(--ddp-radius-md) border ${colors.border} bg-black/40 px-2 py-2 text-center`}
    >
      <span aria-hidden className="text-base">
        {GEAR_SLOT_ICONS[template.slot]}
      </span>
      <span className={`truncate text-[10px] font-bold ${colors.text}`}>
        {colors.icon} {tContent(`${template.id}.name`)}
      </span>
    </div>
  );
}

/** The M7 gear collection grid — see this file's top doc comment. */
function GearCollectionGrid() {
  const inventory = useGameStore((s) => s.inventory);
  const t = useTranslations("codex");
  const discovered = discoveredTemplateIds(inventory);

  return (
    <div className="mt-2">
      <div className="mb-1.5 text-[10px] font-semibold text-ddp-ink-muted">
        {t("gear.ownedCount", { owned: discovered.size, total: GEAR_TEMPLATES.length })}
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {GEAR_TEMPLATES.map((template) => (
          <GearCollectionCard
            key={template.id}
            template={template}
            discovered={discovered.has(template.id)}
          />
        ))}
      </div>
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations>;

/** Resolves an entry's icon + title: from the shared `content` namespace /
 * icon maps for `contentRef` entries (never duplicated here), or from the
 * codex's own `entries.<id>.title` copy otherwise. Plain function (not a
 * hook) — both translators are already resolved by the caller. */
function resolveEntryHeading(
  entry: CodexEntryDef,
  tContent: Translator,
  tCodex: Translator,
): { icon?: string; title: string } {
  if (entry.contentRef?.kind === "heroClass") {
    const cls = entry.contentRef.id;
    return { icon: HERO_ICONS[cls], title: tContent(`classes.${cls}.name`) };
  }
  return { icon: undefined, title: tCodex(`entries.${entry.id}.title`) };
}

function CodexEntryCard({ entry }: { entry: CodexEntryDef }) {
  const tContent = useTranslations("content");
  const tCodex = useTranslations("codex");
  const { icon, title } = resolveEntryHeading(entry, tContent, tCodex);
  const body = tCodex(`entries.${entry.id}.body`);

  return (
    <div className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-ddp-panel px-3 py-2.5">
      <h4 className="mb-1 text-[13px] font-bold text-ddp-gold-bright">
        {icon ? `${icon} ` : ""}
        {title}
      </h4>
      <p className="text-[12.5px] leading-snug text-ddp-ink-muted">{body}</p>
    </div>
  );
}

export interface CodexPanelProps {
  onClose: () => void;
}

export function CodexPanel({ onClose }: CodexPanelProps) {
  const t = useTranslations("codex");
  const resetOnboarding = useGameStore((s) => s.resetOnboarding);

  // "ดูบทช่วยสอนอีกครั้ง": resets FTUE progress to step 0 and closes the
  // panel so `OnboardingOverlay` (which renders directly off the store's
  // `onboardingStepIndex`) retriggers immediately underneath.
  function replayTutorial(): void {
    resetOnboarding();
    onClose();
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <button
        type="button"
        aria-label={t("closeButton")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
          >
            ✕ {t("closeButton")}
          </button>
        </div>

        <button
          type="button"
          onClick={replayTutorial}
          className="min-h-11 rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-left text-xs font-bold text-emerald-300 transition-transform duration-100 hover:brightness-110 active:translate-y-0.5 active:scale-[0.98]"
        >
          {t("replayTutorialButton")}
        </button>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {CODEX_CATEGORIES.map((category) => (
            <section key={category.id}>
              <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
                {t(`categories.${category.id}`)}
              </h3>
              <div className="flex flex-col gap-2">
                {codexEntriesByCategory(category.id).map((entry) => (
                  <CodexEntryCard key={entry.id} entry={entry} />
                ))}
              </div>
              {category.id === "gear" && <GearCollectionGrid />}
            </section>
          ))}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
