/**
 * Pure formatting helper for the skill-detail popover (UX-fix wave, owner ask
 * "every skill button gets a tap-to-open detail... PLUS live numbers derived
 * from CONFIG.skills def"). Kept engine/store-decoupled like `goalLadder.ts`
 * (a plain function over the `SkillType` shape) so the "which numbers show
 * for which skill kind" rule is headlessly testable — see
 * `__tests__/skillStats.test.ts`.
 *
 * Each part is an i18n key suffix (`panels.skillStat.<key>`) + its interpolation
 * values, so the component does the actual translation (this module has no
 * i18n dependency of its own, same pattern as `goalLadder.ts`).
 */

import type { SkillType } from "@/engine";

export interface SkillStatPart {
  /** Suffix into the `panels.skillStat.*` i18n namespace. */
  key: "damage" | "radius" | "targets" | "buff" | "mana" | "cooldown";
  values?: Record<string, string | number>;
}

/** `6.5` -> `"6.5"`, `7` / `7.0` -> `"7"` — every skill's `mult` has at most one
 * decimal digit in the config, but whole numbers should read as `×7`, not `×7.0`. */
function formatMult(mult: number): string {
  return Number.isInteger(mult) ? String(mult) : mult.toFixed(1);
}

/**
 * The ordered stat-line pieces for one skill, kind-aware:
 *  - `buff` kinds (war cry) show the ATK% boost + duration instead of damage
 *    (no `mult`/AoE numbers to show).
 *  - every other kind shows damage (`mult`), then radius (if any AoE), then
 *    the drop/hit count (`targets`, rain/meteor volleys only).
 *  - mana cost and cooldown always trail every skill, in that order.
 */
export function skillStatParts(skill: SkillType): SkillStatPart[] {
  const parts: SkillStatPart[] = [];

  if (skill.kind === "buff") {
    const percent = Math.round((skill.buffMult - 1) * 100);
    parts.push({ key: "buff", values: { percent, seconds: skill.buffDuration } });
  } else if (skill.mult > 0) {
    parts.push({ key: "damage", values: { mult: formatMult(skill.mult) } });
  }

  if (skill.radius > 0) parts.push({ key: "radius", values: { radius: skill.radius } });
  if (skill.targets > 0) parts.push({ key: "targets", values: { targets: skill.targets } });

  parts.push({ key: "mana", values: { cost: skill.cost } });
  parts.push({ key: "cooldown", values: { cd: skill.cd } });

  return parts;
}
