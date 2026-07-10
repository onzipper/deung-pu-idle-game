"use client";

/**
 * Public seam for the codegen game-icon set (issue #60) — the ONLY module
 * consumers (`ItemTile`, `SkillBar`/`SkillDetailModal`, `BotSettingsModal`) import.
 * It re-exports the two registries and wraps each in a resolver that renders the
 * registered icon when one exists for the given engine id, else the caller's
 * `fallback` verbatim (today's emoji/CSS glyph) — so wiring is incremental and a
 * missing icon never blanks a tile.
 *
 * API is a frozen contract (a parallel agent codes the consumers against it):
 *  - ITEM_ICON_COMPONENTS / SKILL_ICON_COMPONENTS: Record<string, FC<{className?}>>
 *  - ItemIcon({ templateId, fallback, className })
 *  - SkillIcon({ skillId, fallback, className })
 */

import type { ReactNode } from "react";
import { ITEM_ICON_COMPONENTS } from "./itemIcons";
import { SKILL_ICON_COMPONENTS } from "./skillIcons";

export { ITEM_ICON_COMPONENTS } from "./itemIcons";
export { SKILL_ICON_COMPONENTS } from "./skillIcons";
export type { IconProps } from "./iconBase";

/** Render the registered item icon for `templateId`, else `fallback` unchanged. */
export function ItemIcon({
  templateId,
  fallback,
  className,
}: {
  templateId: string;
  fallback: ReactNode;
  className?: string;
}) {
  const Icon = ITEM_ICON_COMPONENTS[templateId];
  return Icon ? <Icon className={className} /> : <>{fallback}</>;
}

/** Render the registered skill icon for `skillId`, else `fallback` unchanged. */
export function SkillIcon({
  skillId,
  fallback,
  className,
}: {
  skillId: string;
  fallback: ReactNode;
  className?: string;
}) {
  const Icon = SKILL_ICON_COMPONENTS[skillId];
  return Icon ? <Icon className={className} /> : <>{fallback}</>;
}
