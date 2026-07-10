"use client";

/**
 * R3 "tap profile" (issue #50 Wave 5) — read-only profile card for a tapped
 * ghost-presence peer (docs/ghost-presence-design.md). VIEW-ONLY: no
 * add-friend/invite/whisper actions, no store writes beyond the close
 * button's `onClose` — mirrors `src/ui/hof/HofProfileModal.tsx`'s visual
 * pattern (icon + name + prestige-styled name, own `ModalPortal`, ✕ close)
 * but with none of that modal's gear/badge fetch machinery, since a ghost's
 * `GhostRenderItem` (`presence/ghostStore.ts`) carries only cosmetic
 * identity (name/class/tier) — no loadout, no badges, no new wire fields.
 *
 * Data flow: `GameClient.tsx`'s pointer handler resolves the tap via
 * `GameRenderer.hitTestGhost()` and stashes the resolved identity in a ref
 * BEFORE dispatching `openGhostProfile(cid)` — this component only ever
 * receives already-resolved props, never reads the store or the ghost layer
 * itself. The tap that opens this card is FULLY consumed at the pointer
 * handler (no `moveTo`/`pendingInput` write of any kind).
 */

import { useTranslations } from "next-intl";
import type { HeroClass } from "@/engine";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { HERO_ICONS } from "@/ui/labels";

/** Mirrors `HofProfileModal.tsx`'s private `classNameKeyForTier` (not exported
 * there) — same `content.classes.<cls>.<key>` i18n convention: tier 1 = base
 * name, tier 2 = `evolvedName`, tier 3 = `tier3Name`. */
function classNameKeyForTier(tier: 1 | 2 | 3): "name" | "evolvedName" | "tier3Name" {
  if (tier === 2) return "evolvedName";
  if (tier === 3) return "tier3Name";
  return "name";
}

export interface GhostProfileCardProps {
  name: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  onClose: () => void;
}

export function GhostProfileCard({ name, cls, tier, onClose }: GhostProfileCardProps) {
  const t = useTranslations("ghostProfile");
  const tContent = useTranslations("content");

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-71 flex items-center justify-center p-3"
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
        <div className="animate-onboarding-in relative flex w-full max-w-sm flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
              {t("title")}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {t("closeButton")}
            </button>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-2xl leading-none">
              {HERO_ICONS[cls]}
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-bold text-ddp-ink">{name}</span>
              <span className="text-[10px] text-ddp-ink-muted">
                {tContent(`classes.${cls}.${classNameKeyForTier(tier)}`)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
