"use client";

/**
 * Item icon set (issue #60) — filled silhouette + metallic gradient, keyed by the
 * engine `templateId` (== `ITEM_TEMPLATES`/`lookupTemplate` key in
 * `engine/config/items.ts`). The rarity FRAME/border is `ItemTile`'s job; only the
 * epic sword + the fortifier carry a GOLD glow INSIDE the icon (epic=gold lock,
 * `docs/ui-reference-map.md`). Registry keys are validated against `lookupTemplate`
 * by `__tests__/iconRegistry.test.tsx` (guards the fortifier/legendary superset trap).
 */

import type { FC } from "react";
import { IconSvg, useIconIds, type IconProps } from "./iconBase";

/** ดาบสนิม — humble common blade: dull gray steel with rust, bronze guard, wood grip. */
const RustySword: FC<IconProps> = ({ className }) => {
  const id = useIconIds("blade", "rust", "grip");
  return (
    <IconSvg className={className}>
      <defs>
        <linearGradient id={id.blade} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4ccd4" />
          <stop offset="0.5" stopColor="#8b939c" />
          <stop offset="1" stopColor="#565d66" />
        </linearGradient>
        <radialGradient id={id.rust} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#a3542a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#a3542a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.grip} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a4a24" />
          <stop offset="1" stopColor="#4a2c12" />
        </linearGradient>
      </defs>
      <path d="M12 1.5 13.6 6 13.6 14 12 15.6 10.4 14 10.4 6Z" fill={`url(#${id.blade})`} />
      <path d="M12 1.5 12 15.6 10.4 14 10.4 6Z" fill="#eef2f6" opacity="0.35" />
      <ellipse cx="11.1" cy="9" rx="1.6" ry="2.4" fill={`url(#${id.rust})`} />
      <path d="M7.5 14.3H16.5V16H7.5Z" fill="#a9772f" />
      <path d="M11 16H13V20L12 21 11 20Z" fill={`url(#${id.grip})`} />
      <circle cx="12" cy="21" r="1.2" fill="#a9772f" />
    </IconSvg>
  );
};

/** ธนูสั้น — wooden short bow: warm wood limb bent as a C, taut string + nocked arrow. */
const ShortBow: FC<IconProps> = ({ className }) => {
  const id = useIconIds("wood", "arrow");
  return (
    <IconSvg className={className}>
      <defs>
        <linearGradient id={id.wood} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c68a4a" />
          <stop offset="0.5" stopColor="#8a5a2c" />
          <stop offset="1" stopColor="#5a3818" />
        </linearGradient>
        <linearGradient id={id.arrow} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d9dee4" />
          <stop offset="1" stopColor="#9aa2ab" />
        </linearGradient>
      </defs>
      <path d="M15 2C7 8 7 16 15 22" fill="none" stroke={`url(#${id.wood})`} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M15 3.2C9 8 9 16 15 20.8" fill="none" stroke="#e5c08a" strokeWidth="0.7" strokeLinecap="round" opacity="0.6" />
      <line x1="15" y1="2.5" x2="15" y2="21.5" stroke="#e8eef3" strokeWidth="0.9" opacity="0.85" />
      <line x1="6.5" y1="12" x2="20.5" y2="12" stroke={`url(#${id.arrow})`} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M20.5 12 18 10.4 18 13.6Z" fill="#eceff3" />
      <path d="M6.5 12 8.6 10.6 8.6 13.4Z" fill="#7fae52" />
    </IconSvg>
  );
};

/** ดาบวันสิ้นโลก — epic dramatic blade: dark forged steel, gold flared guard, gold glow. */
const ApocalypseSword: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "steel", "gold", "edge");
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd766" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#e0a020" stopOpacity="0.28" />
          <stop offset="1" stopColor="#e0a020" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.steel} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a5160" />
          <stop offset="0.5" stopColor="#252a34" />
          <stop offset="1" stopColor="#0f1218" />
        </linearGradient>
        <linearGradient id={id.gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a6" />
          <stop offset="0.5" stopColor="#e7b23a" />
          <stop offset="1" stopColor="#9a6d16" />
        </linearGradient>
        <linearGradient id={id.edge} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset="1" stopColor="#e0a020" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="11" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <path d="M12 1 15.2 6.5 14 12 12 16 10 12 8.8 6.5Z" fill={`url(#${id.steel})`} />
      <path d="M12 1 12 16 10 12 8.8 6.5Z" fill={`url(#${id.edge})`} opacity="0.55" />
      <path d="M6 15Q12 12.6 18 15L16.3 17.4Q12 15.4 7.7 17.4Z" fill={`url(#${id.gold})`} />
      <path d="M11 17.2H13V20.4L12 21.4 11 20.4Z" fill="#2a2016" />
      <circle cx="12" cy="21.4" r="1.5" fill={`url(#${id.gold})`} />
    </IconSvg>
  );
};

/** เสื้อผ้า — cloth tunic: earthy woven fabric, V-collar, waist tie. */
const ClothTunic: FC<IconProps> = ({ className }) => {
  const id = useIconIds("cloth");
  return (
    <IconSvg className={className}>
      <defs>
        <linearGradient id={id.cloth} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d8bf90" />
          <stop offset="0.5" stopColor="#ad9160" />
          <stop offset="1" stopColor="#7d6339" />
        </linearGradient>
      </defs>
      <path d="M9 3 8 5 4.5 8 6.5 11 8 9.6 8 20.5 16 20.5 16 9.6 17.5 11 19.5 8 16 5 15 3 13.4 5.4 10.6 5.4Z" fill={`url(#${id.cloth})`} />
      <path d="M9 3 12 6.5 15 3 13.4 5.4 10.6 5.4Z" fill="#5f4c2b" />
      <path d="M8 14.4H16V16H8Z" fill="#6b5330" />
      <path d="M8 9.6 8 20.5 10 20.5 10 9Z" fill="#efdcae" opacity="0.3" />
    </IconSvg>
  );
};

/** หินแกร่ง — fortifier rune-stone: dark forged stone, glowing gold rune, gold glow. */
const WeaponFortifier: FC<IconProps> = ({ className }) => {
  const id = useIconIds("glow", "stone", "rune", "runeglow");
  return (
    <IconSvg className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd766" stopOpacity="0.68" />
          <stop offset="0.6" stopColor="#e0a020" stopOpacity="0.26" />
          <stop offset="1" stopColor="#e0a020" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.stone} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#59524a" />
          <stop offset="0.5" stopColor="#3a342d" />
          <stop offset="1" stopColor="#211d18" />
        </linearGradient>
        <radialGradient id={id.runeglow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a6" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffe9a6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.rune} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset="1" stopColor="#e0a020" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="12" rx="11" ry="11" fill={`url(#${id.glow})`} />
      <path d="M12 2 18.8 6.8 16.8 18 12 21.6 7.2 18 5.2 6.8Z" fill={`url(#${id.stone})`} />
      <path d="M12 2 18.8 6.8 12 9Z" fill="#6f675d" opacity="0.55" />
      <ellipse cx="12" cy="12" rx="5" ry="6" fill={`url(#${id.runeglow})`} />
      <path d="M12 7.5V16M9.3 10.4 12 7.5 14.7 10.4M10 15H14" fill="none" stroke={`url(#${id.rune})`} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </IconSvg>
  );
};

/** Item icon registry — key == engine `templateId` (`lookupTemplate` in items.ts). */
export const ITEM_ICON_COMPONENTS: Record<string, FC<IconProps>> = {
  w_sword_t1_rusty: RustySword,
  w_bow_t1_short: ShortBow,
  w_sword_t10_apocalypse: ApocalypseSword,
  a_cloth_t1_tunic: ClothTunic,
  fort_weapon: WeaponFortifier,
};
