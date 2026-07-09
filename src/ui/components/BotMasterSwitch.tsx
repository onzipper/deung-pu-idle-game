"use client";

/**
 * Bot MASTER switch (owner UX consolidation, 2026-07-07) — ONE prominent
 * ON/OFF control replacing the old standalone `AutoHuntToggle`. OFF = ZERO
 * automation (no auto-hunt, auto-cast, auto-allocate, auto-potion, bot town
 * trips, auto-advance, auto-equip) but manual play (M7.8 tap-to-move/attack,
 * manual skill taps, manual stat +) keeps working exactly as normal — this
 * only silences the AUTOMATION layer, never the player's own input.
 *
 * The switch's own on/off value IS `state.autoHunt` (no new persisted field —
 * see `gameStore.ts`'s `toggleBotMaster` doc for how the OTHER automation
 * flags get gated off of it). The ⚙ button beside it opens `BotSettingsModal`,
 * the single consolidated home for every automation sub-setting (per the
 * house UX rule "one mental model per feature" — see
 * `.claude/skills/game-ux/SKILL.md`) — the explanatory copy lives INSIDE that
 * modal (`hud.botMasterHint`) rather than a third ⓘ button crowding this
 * already-dense HUD row.
 *
 * R2-W2 mount + restyle: moved from `WalkControls.tsx` into `SkillBar.tsx`
 * (mockup's action-bar row reads "skills + AUTO" together) — same component,
 * same store field, ONE home, just a new parent. Restyled the pill itself:
 * bots now default OFF, so the OFF state used to read as "broken"
 * (grayscale, dim) when it's actually the game's normal starting state —
 * swapped the grayscale for a warm gold outline + the same invite-glow pulse
 * `SkillButton` uses on a ready cast, so OFF reads as "tap me", not "disabled".
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BotSettingsModal } from "@/ui/components/BotSettingsModal";
import { useGameStore } from "@/ui/store/gameStore";

export function BotMasterSwitch() {
  const botOn = useGameStore((s) => s.autoHunt);
  const toggleBotMaster = useGameStore((s) => s.toggleBotMaster);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = useTranslations("hud");

  return (
    <div
      data-onboarding-anchor="bot-master"
      className="flex shrink-0 items-center gap-1"
    >
      <button
        type="button"
        onClick={toggleBotMaster}
        aria-pressed={botOn}
        aria-label={botOn ? t("botMasterAriaOn") : t("botMasterAriaOff")}
        className={`relative min-h-11 shrink-0 rounded-full border-2 px-4 py-2 text-xs font-extrabold tracking-wide whitespace-nowrap transition-all duration-150 active:translate-y-0.5 active:scale-[0.97] ${
          botOn
            ? "border-emerald-400/70 bg-emerald-950/60 text-emerald-300 shadow-(--ddp-shadow-btn)"
            : "border-ddp-gold/60 bg-ddp-gold/10 text-ddp-gold-bright shadow-(--ddp-shadow-btn) before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_18px_3px_rgba(242,177,52,0.35)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.4s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110"
        }`}
      >
        🤖 {botOn ? t("botMasterOn") : t("botMasterOff")}
      </button>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label={t("botSettingsButtonAria")}
        title={t("botSettingsButtonAria")}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-ddp-border-soft bg-black/30 text-base text-ddp-ink-muted shadow-(--ddp-shadow-btn) transition-all duration-100 hover:text-ddp-ink active:translate-y-0.5 active:scale-95"
      >
        <span aria-hidden>⚙</span>
      </button>
      {settingsOpen && <BotSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
