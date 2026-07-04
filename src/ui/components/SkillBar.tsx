"use client";

/**
 * Per-hero skill buttons (cast + cooldown sweep) and the auto-cast toggle.
 *
 * The cooldown sweep is pure CSS: a linear `height` animation whose duration
 * is the skill's max cooldown and whose `animation-delay` is negative by the
 * ALREADY-elapsed amount, so it visually resumes at the right point from a
 * single throttled snapshot value instead of a 60 Hz store write. It only
 * restarts (remounts via `key`) when a fresh cast is detected.
 */

import { useEffect, useRef, useState } from "react";
import { SKILL_TYPES } from "@/engine";
import type { HeroSummary } from "@/ui/store/gameStore";
import { HERO_LABELS, SKILL_LABELS } from "@/ui/labels";
import { useGameStore } from "@/ui/store/gameStore";

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

  const ready = hero.skillCd <= 0 && !hero.dead;
  const delay = -(maxCd - hero.skillCd);
  const hpPct = hero.maxHp > 0 ? Math.max(0, (hero.hp / hero.maxHp) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="h-1 w-14 overflow-hidden rounded-full bg-black/50" title={heroLabel.name}>
        <div
          className={`h-full rounded-full ${hpPct > 35 ? "bg-emerald-400" : "bg-red-500"}`}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => castSkill(slot)}
        className="relative flex h-16 w-16 flex-col items-center justify-center overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100 transition enabled:hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="text-xl leading-none">{label.icon}</span>
        <span className="mt-1 text-[9px] leading-none text-zinc-400">{label.name}</span>
        {hero.skillCd > 0 && !hero.dead && (
          <span
            key={castKey}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 [animation-name:ddp-cooldown-sweep] [animation-timing-function:linear] [animation-fill-mode:forwards]"
            style={{ animationDuration: `${maxCd}s`, animationDelay: `${delay}s` }}
          />
        )}
        {hero.dead && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] text-red-400">
            ตาย
          </span>
        )}
      </button>
    </div>
  );
}

export function SkillBar() {
  const heroes = useGameStore((s) => s.heroes);
  const autoCast = useGameStore((s) => s.autoCast);
  const toggleAutoCast = useGameStore((s) => s.toggleAutoCast);

  return (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-900/80 px-3 py-2">
      {/* Global (registered once) — the linear cooldown-sweep keyframes. */}
      <style>{`
        @keyframes ddp-cooldown-sweep {
          from { height: 100%; }
          to { height: 0%; }
        }
      `}</style>
      <div className="flex gap-2">
        {heroes.map((hero, i) => (
          <SkillButton key={i} hero={hero} slot={i} />
        ))}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={toggleAutoCast}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          autoCast
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "border-zinc-700 bg-zinc-800 text-zinc-400"
        }`}
      >
        🪄 Auto สกิล: {autoCast ? "เปิด" : "ปิด"}
      </button>
    </div>
  );
}
