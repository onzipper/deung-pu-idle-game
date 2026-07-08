/**
 * Buff Badge Hub (owner ask: "มี badge บอกสถานะบัพด้วย เอาบัพทั้งหมดไปรวมตรงนั้น
 * ไม่ว่าจะสถานะเพิ่ม stat หรือ พิเศษจากอะไรก็ตาม" — one consolidated HUD spot for
 * EVERY active buff, regardless of source). Pure TS, no React/DOM — same
 * "logic here, view in components/" split as `ui/worldBoss/schedule.ts` +
 * `components/WorldBossBanner.tsx`, so the badge set is headlessly testable
 * (`__tests__/activeBuffs.test.ts`).
 *
 * EXTENSIBLE BY DESIGN: each source is its own small `BuffBadgeBuilder`
 * function pushed onto `BUFF_BADGE_BUILDERS` below. A future status (endgame
 * event, potion, champion-month aura, …) just adds one more builder here —
 * `BuffBadgeHub.tsx` never needs to change. `ActiveBuffInput` may grow new
 * optional-ish fields as new sources need new snapshot data; existing
 * builders simply ignore fields they don't read.
 */

import { CONFIG } from "@/engine";

/** Discriminates which i18n keys (`buffHub.chip.<kind>` / `buffHub.detail.<kind>`)
 * a badge resolves against — `BuffBadgeHub.tsx`'s only coupling to a specific
 * buff's copy. */
export type BuffBadgeKind = "partyExp" | "warCry";

export interface BuffBadge {
  /** Stable React key AND the i18n key segment (`kind` doubles as `id` today —
   * kept as a distinct field since a future source may need more than one
   * badge of the same kind, e.g. multiple stackable potions). */
  id: string;
  kind: BuffBadgeKind;
  /** Win10-safe emoji (footgun #4) — rendered `aria-hidden` beside the
   * translated label; never baked into the i18n string itself. */
  icon: string;
  /** ICU interpolation vars for BOTH `chip.<kind>` (compact label) and
   * `detail.<kind>` (tap-to-open tooltip body). */
  params: Record<string, string | number>;
}

/** Read-only snapshot slice every builder receives — deliberately narrow
 * (only the fields the v1 sources need) so a headless test can construct one
 * without touching the full `EngineSnapshot`/`HeroSummary` shape. */
export interface ActiveBuffInput {
  /** Cohort size — `heroes.length` off the throttled snapshot. `1` = solo
   * (no party buff to show). */
  heroesLength: number;
  /** MY hero's War Cry ATK multiplier (`HeroSummary.atkBuffMult`) — `1` while
   * inactive. */
  atkBuffMult: number;
  /** MY hero's War Cry remaining seconds (`HeroSummary.atkBuffTimer`) — `<= 0`
   * while inactive. */
  atkBuffTimer: number;
}

type BuffBadgeBuilder = (input: ActiveBuffInput) => BuffBadge | null;

/** Party XP buff (`CONFIG.party.expBuff(size)`, exported pure from the
 * engine) — active whenever the player shares a zone-beat cohort with at
 * least one other live member. Solo (`heroesLength <= 1`) never renders (the
 * multiplier is exactly 1 by construction, see `partyExpBuff` in
 * `engine/config`). */
const partyExpBuilder: BuffBadgeBuilder = (input) => {
  if (input.heroesLength <= 1) return null;
  const mult = CONFIG.party.expBuff(input.heroesLength);
  const percent = Math.round((mult - 1) * 100);
  if (percent <= 0) return null;
  return {
    id: "partyExp",
    kind: "partyExp",
    icon: "\u{1F91D}", // 🤝
    params: { percent, count: input.heroesLength },
  };
};

/** War Cry ATK buff (`hero.atkBuffMult`/`atkBuffTimer`, engine skill
 * `sword_warcry` — applies to every living hero, not just the caster). The
 * snapshot is throttled ~10Hz; `BuffBadgeHub.tsx` interpolates its own smooth
 * countdown between updates the same way `SkillBar.tsx` already does — this
 * builder just carries the raw seconds through. */
const warCryBuilder: BuffBadgeBuilder = (input) => {
  if (input.atkBuffTimer <= 0) return null;
  const percent = Math.round((input.atkBuffMult - 1) * 100);
  const seconds = Math.max(0, Math.ceil(input.atkBuffTimer));
  return {
    id: "warCry",
    kind: "warCry",
    icon: "⚔", // ⚔
    params: { percent, seconds },
  };
};

/** Registration order = display order. Add a future source here. */
const BUFF_BADGE_BUILDERS: readonly BuffBadgeBuilder[] = [partyExpBuilder, warCryBuilder];

/** The Buff Badge Hub's full active set for the current snapshot, in display
 * order. Empty while nothing is active (the hub renders nothing then — same
 * "renders nothing, zero HUD footprint for the common case" idiom as
 * `CohortStatus`/`WorldBossBanner`). */
export function buildActiveBuffBadges(input: ActiveBuffInput): BuffBadge[] {
  const badges: BuffBadge[] = [];
  for (const build of BUFF_BADGE_BUILDERS) {
    const badge = build(input);
    if (badge) badges.push(badge);
  }
  return badges;
}
