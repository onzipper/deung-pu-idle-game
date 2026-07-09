"use client";

/**
 * R2.6 Wave 2 "skill dock reskin": the bottom-center skill/bot/potion card
 * used to be inlined directly in `GameHud.tsx` (skills row + divider + potion
 * row, always fully expanded). This file is the extraction + the new
 * collapsible behavior, cloning `GoalLadder.tsx`'s Wave-1 whole-card-collapse
 * idiom byte-for-byte (persisted `skillDockCollapsed` store field, same
 * localStorage tier as `questTrackerCollapsed`/`ghostsVisible`, FTUE-forced
 * expansion via `onboardingActive`).
 *
 * ONE ROW when expanded: skill tiles (`SkillBar`) + the bot MASTER switch
 * (`BotMasterSwitch`, MOVED here from `SkillBar.tsx` — it must render exactly
 * once, grep `data-onboarding-anchor="bot-master"` after touching this area)
 * + potion quick-slots (`ConsumableBar`) + a collapse chevron, wrapping on
 * narrow mobile widths.
 *
 * Collapsed = a thin strip: `BotMasterSwitch` STAYS TAPPABLE (never
 * hidden-classed — the owner-off-by-default bot needs the toggle reachable
 * at all times) + a centered expand chevron. The skill-tile and potion rows
 * stay MOUNTED but `hidden`-classed (never unmounted) so their FTUE anchors
 * (`skill-bar`, `consumables`) keep resolving in the DOM while collapsed —
 * same trick `GoalLadder.tsx` uses for its own tab content.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { BotMasterSwitch } from "@/ui/components/BotMasterSwitch";
import { ConsumableBar } from "@/ui/components/ConsumableBar";
import { SkillBar } from "@/ui/components/SkillBar";
import { readStoredSkillDockCollapsed, useGameStore } from "@/ui/store/gameStore";

export function SkillDock() {
  const skillDockCollapsed = useGameStore((s) => s.skillDockCollapsed);
  const toggleSkillDockCollapsed = useGameStore((s) => s.toggleSkillDockCollapsed);
  const setSkillDockCollapsed = useGameStore((s) => s.setSkillDockCollapsed);
  const onboardingActive = useGameStore((s) => s.onboardingStepIndex >= 0);
  const t = useTranslations("panels");

  // Apply the persisted preference once, AFTER hydration — same idiom as
  // `GoalLadder.tsx`'s mount-only sync (reading localStorage during the
  // initial render would desync SSR/first-client render).
  useEffect(() => {
    setSkillDockCollapsed(readStoredSkillDockCollapsed());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  // FTUE must never spotlight a collapsed target — see `castSkill`/
  // `slotAutoSkill`/`botSwitchIntro` steps (`skill-bar`/`bot-master` anchors).
  const expanded = !skillDockCollapsed || onboardingActive;

  return (
    // Issue #58 wave B: mobile padding tightened (`py-2`, was `py-3`) to
    // reclaim ~8px of vertical room on short landscape viewports (e.g.
    // 640x360) — `sm:py-3` restores the original desktop chrome exactly, so
    // desktop doesn't regress.
    <div className="mx-2 w-full max-w-xl rounded-(--ddp-radius-lg) border border-ddp-border bg-black/45 px-3 py-2 shadow-(--ddp-shadow-panel) backdrop-blur-sm sm:py-3">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {/* Skill tiles — stays MOUNTED (hidden-classed) while collapsed so the
            `skill-bar` FTUE anchor nested inside always resolves. */}
        <div className={expanded ? "contents" : "hidden"}>
          <SkillBar />
        </div>
        {/* Bot MASTER switch — the ONE mount (moved out of `SkillBar.tsx`),
            NEVER hidden-classed: it must stay tappable in the collapsed thin
            strip too. */}
        <BotMasterSwitch />
        {/* Potion quick-slots — same "stays mounted, hidden-classed" rule as
            the skill tiles above, keeping the `consumables` FTUE anchor
            resolvable while collapsed. */}
        <div className={expanded ? "contents" : "hidden"}>
          <ConsumableBar />
        </div>
        <button
          type="button"
          onClick={toggleSkillDockCollapsed}
          aria-expanded={expanded}
          aria-label={expanded ? t("dockCollapseAria") : t("dockExpandAria")}
          className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-ddp-border-soft bg-black/30 text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-95 sm:min-h-11 sm:min-w-11"
        >
          <span aria-hidden className="text-sm leading-none">
            {expanded ? "▾" : "▴"}
          </span>
        </button>
      </div>
    </div>
  );
}
