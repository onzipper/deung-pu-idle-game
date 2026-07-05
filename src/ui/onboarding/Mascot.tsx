/**
 * Procedural mascot (M4.8 card B) — inline SVG/CSS, zero binary assets, per
 * project convention. Presents ALL tutorial dialogue (FTUE steps + contextual
 * tips) from the "slot next to the title" in `TutorialOverlayShell.tsx`.
 * Name lives in i18n (`onboarding.mascotName`), not hardcoded here — this
 * file only draws the little guy.
 *
 * Jewel-tone gold body (matches `--ddp-gold`/`--ddp-gold-bright`, the same
 * currency/reward accent already used across the HUD) over a thin near-navy
 * outline, per `render/README.md`'s binding "saturated entity vs desaturated
 * scenery" art direction. Idle bob + slow blink are plain CSS keyframes
 * (`globals.css`) — subtle and cheap, never distracting; mood only swaps a
 * static eyebrow/mouth path plus a small constant tilt, no animation library.
 */

import type { MascotMood } from "@/ui/onboarding/mascotMood";

const MOOD_TILT_DEG: Record<MascotMood, number> = {
  neutral: 0,
  excited: -6,
  warning: 3,
};

export interface MascotProps {
  mood?: MascotMood;
  className?: string;
}

export function Mascot({ mood = "neutral", className = "" }: MascotProps) {
  return (
    <div
      aria-hidden
      className={`shrink-0 ${className}`}
      style={{ transform: `rotate(${MOOD_TILT_DEG[mood]}deg)` }}
    >
      <div className="animate-mascot-bob h-11 w-11">
        <svg viewBox="0 0 44 44" className="h-full w-full overflow-visible">
          {/* body: a rounded "drop" silhouette (echoes ดึ๋งปุ๊'s bouncy tone) */}
          <path
            d="M22 3c7.5 6.5 15 13.5 15 22.5a15 15 0 1 1-30 0C7 16.5 14.5 9.5 22 3z"
            fill="var(--ddp-gold)"
            stroke="#1c2140"
            strokeWidth="1.6"
          />
          {/* belly shade — flat alpha layer, no gradients (POC-bug rule) */}
          <ellipse
            cx="22"
            cy="27"
            rx="10"
            ry="8"
            fill="var(--ddp-gold-bright)"
            opacity="0.35"
          />

          {mood === "warning" && (
            <>
              <path
                d="M13.5 20.5l4.5 1.8"
                stroke="#241a05"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M30.5 20.5l-4.5 1.8"
                stroke="#241a05"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </>
          )}

          <g className="animate-mascot-blink" style={{ transformOrigin: "22px 25px" }}>
            <circle cx="17" cy="25" r="2.3" fill="#241a05" />
            <circle cx="27" cy="25" r="2.3" fill="#241a05" />
          </g>

          {mood === "excited" ? (
            <path
              d="M16 30.5q6 5.5 12 0"
              stroke="#241a05"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          ) : mood === "warning" ? (
            <path
              d="M17 32.5q5 -2.5 10 0"
              stroke="#241a05"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M17.5 31q4.5 2.5 9 0"
              stroke="#241a05"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
