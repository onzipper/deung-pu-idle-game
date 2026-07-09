"use client";

/**
 * Skill icon set (issue #60) — filled silhouette + glass gradient + soft
 * family-color glow, keyed by the engine skill id (`SKILLS` in
 * `engine/config/index.ts`). Registry keys are validated against `SKILLS` by
 * `__tests__/iconRegistry.test.tsx`. Each icon leads with its element colour so
 * the four read apart at a glance in the skill dock (`docs/ui-reference-map.md`).
 */

import type { FC } from "react";
import { IconSvg, useIconIds, type IconProps } from "./iconBase";

/** วนดาบ — whirl slash: twin steel-violet crescents spun into a spiral, violet glow. */
const SwordWhirl: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "violet", "steel");
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c9a6ff" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#7c3fe0" stopOpacity="0.3" />
          <stop offset="1" stopColor="#7c3fe0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.violet} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0ccff" />
          <stop offset="0.5" stopColor="#a878f2" />
          <stop offset="1" stopColor="#6a30cf" />
        </linearGradient>
        <linearGradient id={id.steel} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f2f5f9" />
          <stop offset="1" stopColor="#9aa2ac" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="12" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <path d="M12 2.5C18 3.5 21 9 19.5 15C18.6 10.4 15 7.6 11 8.4C13 6.4 13 4 12 2.5Z" fill={`url(#${id.violet})`} />
      <path d="M12 21.5C6 20.5 3 15 4.5 9C5.4 13.6 9 16.4 13 15.6C11 17.6 11 20 12 21.5Z" fill={`url(#${id.violet})`} />
      <path d="M6 6 18 18" stroke={`url(#${id.steel})`} strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
    </IconSvg>
  );
};

/** อุกกาบาต — meteor: white-hot core, orange trail streaking down-left, rocky chips. */
const MageMeteor: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "trail", "core");
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb24d" stopOpacity="0.75" />
          <stop offset="0.6" stopColor="#e0431c" stopOpacity="0.3" />
          <stop offset="1" stopColor="#e0431c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.trail} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#ff9838" stopOpacity="0.85" />
          <stop offset="1" stopColor="#e33417" />
        </linearGradient>
        <radialGradient id={id.core} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fff7e0" />
          <stop offset="0.4" stopColor="#ffcf52" />
          <stop offset="0.75" stopColor="#f47320" />
          <stop offset="1" stopColor="#a82410" />
        </radialGradient>
      </defs>
      <ellipse cx="12" cy="12" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <path d="M21 2.5 13.5 11 7 17.5 10.5 13.5 15.5 8Z" fill={`url(#${id.trail})`} />
      <circle cx="8" cy="16.5" r="4.4" fill={`url(#${id.core})`} />
      <circle cx="6.6" cy="15" r="0.9" fill="#7a1e0c" opacity="0.7" />
      <circle cx="9.2" cy="17.6" r="0.7" fill="#7a1e0c" opacity="0.6" />
    </IconSvg>
  );
};

/** เกล็ดน้ำแข็ง — frost nova: radial ice shards bursting from a glassy core, blue glow. */
const MageFrostnova: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "ice", "core");
  const shards = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#bfeaff" stopOpacity="0.8" />
          <stop offset="0.6" stopColor="#3a86e0" stopOpacity="0.3" />
          <stop offset="1" stopColor="#3a86e0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.ice} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2fbff" />
          <stop offset="0.5" stopColor="#a9e0ff" />
          <stop offset="1" stopColor="#4a9fe6" />
        </linearGradient>
        <radialGradient id={id.core} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#c6ecff" />
          <stop offset="1" stopColor="#5aa8ea" />
        </radialGradient>
      </defs>
      <ellipse cx="12" cy="12" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <g fill={`url(#${id.ice})`}>
        {shards.map((deg) => (
          <path key={deg} d="M12 2 12.9 9.5 12 11 11.1 9.5Z" transform={`rotate(${deg} 12 12)`} />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.6" fill={`url(#${id.core})`} />
      <circle cx="11.2" cy="11.2" r="0.8" fill="#ffffff" opacity="0.9" />
    </IconSvg>
  );
};

/** ห่าธนู — arrow rain: three teal-green arrows raining down-right, teal glow. */
const ArcherRain: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "shaft", "head");
  const arrows = [
    { x: 0, y: -1 },
    { x: 5, y: 2 },
    { x: 10, y: -0.5 },
  ];
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8affc9" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#12b28a" stopOpacity="0.3" />
          <stop offset="1" stopColor="#12b28a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.shaft} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d6fff0" />
          <stop offset="1" stopColor="#2fb98f" />
        </linearGradient>
        <linearGradient id={id.head} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9dffca" />
          <stop offset="1" stopColor="#1f9c6a" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="12" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <g strokeLinecap="round">
        {arrows.map((a, i) => (
          <g key={i} transform={`translate(${a.x} ${a.y})`}>
            <line x1="3.5" y1="3" x2="9.5" y2="13" stroke={`url(#${id.shaft})`} strokeWidth="1.3" />
            <path d="M9.5 13 7.4 11.8 9.4 10.4Z" fill={`url(#${id.head})`} />
            <path d="M3.5 3 2 3.6 3.2 5 4.7 4.4Z" fill="#d6fff0" opacity="0.85" />
          </g>
        ))}
      </g>
    </IconSvg>
  );
};

/** Skill icon registry — key == engine skill id (`SKILLS` in engine/config/index.ts). */
export const SKILL_ICON_COMPONENTS: Record<string, FC<IconProps>> = {
  sword_whirl: SwordWhirl,
  mage_meteor: MageMeteor,
  mage_frostnova: MageFrostnova,
  archer_rain: ArcherRain,
};
