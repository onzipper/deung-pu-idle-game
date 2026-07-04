"use client";

/**
 * Per-hero skill buttons (cast + cooldown sweep) and the auto-cast toggle.
 *
 * The cooldown sweep is pure CSS: a linear `height` animation whose duration
 * is the skill's max cooldown and whose `animation-delay` is negative by the
 * ALREADY-elapsed amount, so it visually resumes at the right point from a
 * single throttled snapshot value instead of a 60 Hz store write. It only
 * restarts (remounts via `key`) when a fresh cast is detected. The keyframes
 * (`ddp-cooldown-sweep`, `ddp-invite-glow`) live in globals.css alongside the
 * rest of the HUD's shared animation vocabulary.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HeroClass } from "@/engine";
import { SKILL_TYPES } from "@/engine";
import type { HeroSummary } from "@/ui/store/gameStore";
import { HERO_LABELS, SKILL_LABELS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

/** Presentational-only per-class accent (mirrors src/render/theme.ts
 * HERO_COLORS so a hero's skill button reads as "the same character" as
 * their in-canvas sprite) — never fed back into the engine, purely a local
 * styling constant. `soft` is a pre-mixed rgba so button classes never need a
 * Tailwind opacity-modifier on an arbitrary CSS-var color (unsupported
 * combination) — just a plain var() substitution. */
const HERO_ACCENT: Record<HeroClass, { solid: string; soft: string }> = {
  swordsman: { solid: "#35d0c0", soft: "rgba(53, 208, 192, 0.55)" },
  archer: { solid: "#b8e04a", soft: "rgba(184, 224, 74, 0.55)" },
  mage: { solid: "#c77dff", soft: "rgba(199, 125, 255, 0.55)" },
};

/** Detects a fresh cast (skillCd jumped back up) to restart the CSS sweep. */
function useCastKey(skillCd: number): number {
  const prev = useRef(skillCd);
  const [castKey, setCastKey] = useState(0);
  useEffect(() => {
    if (skillCd > prev.current + 0.05) {
      setCastKey((k) => k + 1);
    }
    prev.current = skillCd;
  }, [skillCd]);
  return castKey;
}

function SkillButton({ hero, slot }: { hero: HeroSummary; slot: number }) {
  const castSkill = useGameStore((s) => s.castSkill);
  const maxCd = SKILL_TYPES[hero.cls].cd;
  const label = SKILL_LABELS[hero.cls];
  const heroLabel = HERO_LABELS[hero.cls];
  const castKey = useCastKey(hero.skillCd);
  const accent = HERO_ACCENT[hero.cls];

  const ready = hero.skillCd <= 0 && !hero.dead;
  const delay = -(maxCd - hero.skillCd);
  const hpPct = hero.maxHp > 0 ? Math.max(0, (hero.hp / hero.maxHp) * 100) : 0;
  const cdSeconds = Math.ceil(hero.skillCd);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-1.5 w-14 overflow-hidden rounded-full bg-black/50"
        title={heroLabel.name}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            hpPct > 35 ? "bg-emerald-400" : "bg-red-500"
          }`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => castSkill(slot)}
        aria-label={`${heroLabel.name}: ${label.name}${
          hero.dead ? " (ตาย)" : ready ? "" : ` (คูลดาวน์ ${cdSeconds} วิ)`
        }`}
        style={{ "--accent": accent.solid, "--accent-soft": accent.soft } as CSSProperties}
        className={`relative h-16 w-16 rounded-(--ddp-radius-md) border shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.96] ${
          ready
            ? "border-[color:var(--accent-soft)] before:absolute before:-inset-1 before:-z-10 before:rounded-[inherit] before:shadow-[0_0_18px_3px_var(--accent-soft)] before:[animation-name:ddp-invite-glow] before:[animation-duration:2.4s] before:[animation-timing-function:ease-in-out] before:[animation-iteration-count:infinite] before:content-[''] hover:brightness-110"
            : "border-ddp-border disabled:cursor-not-allowed"
        }`}
      >
        <span
          className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[inherit] bg-ddp-panel-strong ${
            !ready ? "grayscale" : ""
          }`}
        >
          <span className="text-xl leading-none">{label.icon}</span>
          <span className="mt-1 text-[9px] leading-none text-ddp-ink-muted">{label.name}</span>
          {hero.skillCd > 0 && !hero.dead && (
            <span
              key={castKey}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 [animation-name:ddp-cooldown-sweep] [animation-timing-function:linear] [animation-fill-mode:forwards]"
              style={{ animationDuration: `${maxCd}s`, animationDelay: `${delay}s` }}
            />
          )}
          {hero.skillCd > 0 && !hero.dead && (
            <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-black/60 px-1 text-[9px] font-bold text-ddp-ink tabular-nums">
              {cdSeconds}
            </span>
          )}
          {hero.dead && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] font-bold text-red-400">
              ตาย
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

export function SkillBar() {
  const heroes = useGameStore((s) => s.heroes);
  const autoCast = useGameStore((s) => s.autoCast);
  const toggleAutoCast = useGameStore((s) => s.toggleAutoCast);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        สกิล
      </span>
      <div className="flex gap-2">
        {heroes.map((hero, i) => (
          <SkillButton key={i} hero={hero} slot={i} />
        ))}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={toggleAutoCast}
        aria-pressed={autoCast}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-(--ddp-radius-md) border px-3 py-2 text-xs font-bold shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.97] ${
          autoCast
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${autoCast ? "bg-emerald-950" : "bg-ddp-ink-muted"}`}
        />
        {/* ✨ not 🪄: the magic-wand emoji (Unicode 13) has no glyph on Windows 10 */}
        ✨ Auto สกิล: {autoCast ? "เปิด" : "ปิด"}
      </button>
    </div>
  );
}
