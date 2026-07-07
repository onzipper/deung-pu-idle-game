"use client";

/**
 * M7.95 Hall of Fame — read-only profile popover for a tapped leaderboard
 * row: paper-doll snapshot off the entry's `profile` field, reusing the same
 * icon/name/refine-badge/prestige-styling conventions as
 * `EquippedLoadout.tsx` (this is a static wire snapshot, not the live sim's
 * `HeroSummary.equipped`, so it reads `entry.profile.loadout`/`refineLevels`
 * instead of the store). Own `ModalPortal` (mandatory for every new modal,
 * see that file's doc) stacked one z-step above `HallOfFamePanel` (z-71 vs
 * z-70) so it always paints on top of the list it was opened from.
 */

import { useTranslations } from "next-intl";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { GEAR_SLOT_ICONS, HERO_ICONS, prestigeNameClass } from "@/ui/labels";
import type { HofEntry } from "@/ui/hof/types";

const SLOT_ORDER: readonly ("weapon" | "armor")[] = ["weapon", "armor"];

/** `content.classes.<cls>.<key>` i18n key for `entry.tier`'s display name —
 * tier 1 = base name, tier 2 = `evolvedName`, tier 3 = `tier3Name`. Mirrors
 * `SkillBar.tsx`'s private `classNameKeyForTier` (that one isn't exported —
 * this is just a display-side read of the same convention, no game logic). */
function classNameKeyForTier(tier: 1 | 2 | 3): "name" | "evolvedName" | "tier3Name" {
  if (tier === 2) return "evolvedName";
  if (tier === 3) return "tier3Name";
  return "name";
}

export interface HofProfileModalProps {
  entry: HofEntry;
  onClose: () => void;
}

export function HofProfileModal({ entry, onClose }: HofProfileModalProps) {
  const t = useTranslations("hof");
  const tCommon = useTranslations("common");
  const tContent = useTranslations("content");
  const tContentItems = useTranslations("content.items");
  const tInventory = useTranslations("inventory");

  const nameCls = prestigeNameClass(
    Math.max(entry.profile.refineLevels.weapon, entry.profile.refineLevels.armor),
  );
  // Server-computed cosmetic signal (see types.ts's doc) — purely an extra
  // aura ring on the card header, never required for the rest to render.
  const auraRing =
    entry.profile.prestigeTier > 0
      ? "ring-2 ring-ddp-gold-bright shadow-[0_0_18px_4px_rgba(250,204,21,0.45)]"
      : "";

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-71 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("profileTitle")}
      >
        <button
          type="button"
          aria-label={t("closeButton")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <div
          className={`animate-onboarding-in relative flex w-full max-w-sm flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel) ${auraRing}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="text-2xl leading-none">
                {HERO_ICONS[entry.cls]}
              </span>
              <div className="flex min-w-0 flex-col leading-tight">
                <span className={`truncate text-sm ${nameCls || "font-bold text-ddp-ink"}`}>
                  {entry.charName}
                </span>
                <span className="text-[10px] text-ddp-ink-muted">
                  {tContent(`classes.${entry.cls}.${classNameKeyForTier(entry.tier)}`)} ·{" "}
                  {tCommon("levelBadge", { level: entry.level })}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {t("closeButton")}
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {SLOT_ORDER.map((slot) => {
              const templateId = entry.profile.loadout[slot];
              const refineLevel = entry.profile.refineLevels[slot] ?? 0;
              const slotNameCls = prestigeNameClass(refineLevel);
              return (
                <div
                  key={slot}
                  className="flex items-center gap-1.5 rounded-full border border-ddp-border-soft bg-black/40 px-2.5 py-1.5 text-xs font-bold text-ddp-ink"
                >
                  <span aria-hidden>{GEAR_SLOT_ICONS[slot]}</span>
                  {templateId ? (
                    <span className={slotNameCls}>
                      {tContentItems(`${templateId}.name`)}
                      {refineLevel > 0 && (
                        <span className={slotNameCls || "text-emerald-400"}>
                          {" "}
                          {tInventory("refinePlus", { level: refineLevel })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-ddp-ink-muted">{t("emptySlot")}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
