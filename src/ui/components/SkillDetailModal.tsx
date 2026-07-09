"use client";

/**
 * R2-W4 skill detail pane (`docs/ui-reference-map.md`'s SKILL UI row) —
 * evolves the old per-skill ⓘ text popover (`InfoTip`, formerly inline in
 * `SkillBar.tsx`) into a real list + detail view: a list column of the
 * hero's CURRENT TIER CHAIN of learned skills (icon + name + status dot),
 * and a detail pane showing an enlarged glowing icon (code-only art — no
 * painted sprite, per the R1 art gate) plus the description and the SAME
 * live stat lines `skillStatParts` already computed (damage/radius/targets/
 * buff/mana/cooldown, off `CONFIG.skills` — nothing new engine-side).
 *
 * Read-only by design: tapping a list row only changes which skill is
 * SHOWN — it never casts (`castSkill` stays exclusively on `SkillBar.tsx`'s
 * cast buttons) and there is no skill-leveling UI here (Lv./MAX/upgrade is a
 * parked backlog feature per the task brief — no placeholder rendered for
 * it). Auto-cast slot assignment keeps living on `SkillBar.tsx`'s
 * "+ อัตโนมัติ" badge (unchanged, still works) — this modal doesn't
 * duplicate that affordance.
 *
 * Desktop: list column beside the detail pane (`md:flex-row`). Mobile: list
 * becomes a horizontal scroll strip stacked above the detail pane
 * (`flex-col`) — already inside `ModalPortal`, so no separate bottom-sheet
 * mechanism is needed (the whole thing already renders as a portal-escaped
 * fixed overlay, same as every other modal in the house).
 */

import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import { SKILLS } from "@/engine";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { HERO_ACCENT, SKILL_ICONS_BY_ID } from "@/ui/labels";
import { skillStatParts } from "@/ui/skillStats";
import type { HeroSummary, SkillSummary } from "@/ui/store/gameStore";

export interface SkillDetailModalProps {
  hero: HeroSummary;
  initialId: string;
  onClose: () => void;
}

type SkillStatus = "ready" | "cooldown" | "nomana" | "dead";

function statusOf(hero: HeroSummary, skill: SkillSummary): SkillStatus {
  if (hero.dead) return "dead";
  if (skill.ready) return "ready";
  if (skill.cd > 0) return "cooldown";
  return "nomana";
}

const STATUS_DOT_CLASS: Record<SkillStatus, string> = {
  ready: "bg-emerald-400",
  cooldown: "bg-amber-400",
  nomana: "bg-sky-400",
  dead: "bg-red-500",
};

const STATUS_TEXT_CLASS: Record<SkillStatus, string> = {
  ready: "text-emerald-300",
  cooldown: "text-amber-300",
  nomana: "text-sky-300",
  dead: "text-red-400",
};

/** `SkillStatus` -> the `panels.skillDetail.status*` i18n key (cooldown is
 * handled separately below since it interpolates `{seconds}`). */
const STATUS_KEY: Record<Exclude<SkillStatus, "cooldown">, "statusReady" | "statusNoMana" | "statusDead"> = {
  ready: "statusReady",
  nomana: "statusNoMana",
  dead: "statusDead",
};

function ListRow({
  hero,
  skill,
  active,
  onSelect,
  tContent,
}: {
  hero: HeroSummary;
  skill: SkillSummary;
  active: boolean;
  onSelect: () => void;
  tContent: ReturnType<typeof useTranslations>;
}) {
  const accent = HERO_ACCENT[hero.cls];
  const icon = SKILL_ICONS_BY_ID[skill.id] ?? "✦";
  const status = statusOf(hero, skill);

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      style={{ "--accent-soft": accent.soft } as CSSProperties}
      className={`flex min-h-12 w-36 shrink-0 items-center gap-2 rounded-(--ddp-radius-md) border px-2.5 py-2 text-left transition-colors duration-100 md:w-auto ${
        active
          ? "border-(--accent-soft) bg-black/40"
          : "border-ddp-border-soft bg-black/20 hover:border-(--accent-soft)"
      }`}
    >
      <span aria-hidden className="shrink-0 text-xl leading-none">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ddp-ink">
        {tContent(`skills.${skill.id}.name`)}
      </span>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
    </button>
  );
}

export function SkillDetailModal({ hero, initialId, onClose }: SkillDetailModalProps) {
  const [selectedId, setSelectedId] = useState(initialId);
  const t = useTranslations("panels.skillDetail");
  const tContent = useTranslations("content");
  const tPanels = useTranslations("panels");

  const skill = hero.skills.find((s) => s.id === selectedId) ?? hero.skills[0];
  if (!skill) return null; // defensive — the trigger only ever opens with a learned skill id

  const skillDef = SKILLS[skill.id];
  const accent = HERO_ACCENT[hero.cls];
  const icon = SKILL_ICONS_BY_ID[skill.id] ?? "✦";
  const status = statusOf(hero, skill);
  const statusText =
    status === "cooldown"
      ? t("statusCooldown", { seconds: Math.ceil(skill.cd) })
      : t(STATUS_KEY[status]);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-70 flex items-center justify-center p-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
      >
        <button
          type="button"
          aria-label={t("closeButton")}
          onClick={onClose}
          className="absolute inset-0 bg-black/70"
        />
        <Panel
          variant="gold"
          className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-hidden md:max-w-2xl"
        >
          <PanelHeader
            title={t("title")}
            icon={<span aria-hidden>{icon}</span>}
            actions={
              <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
                ✕ {t("closeButton")}
              </Button>
            }
          />

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:flex-row md:overflow-visible">
            <div
              role="listbox"
              aria-label={t("listAria")}
              className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto md:pr-1 md:pb-0"
            >
              {hero.skills.map((s) => (
                <ListRow
                  key={s.id}
                  hero={hero}
                  skill={s}
                  active={s.id === skill.id}
                  onSelect={() => setSelectedId(s.id)}
                  tContent={tContent}
                />
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-4 text-center">
              <span
                aria-hidden
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 bg-black/50 text-4xl leading-none"
                style={{ borderColor: accent.solid, boxShadow: `0 0 22px 5px ${accent.soft}` }}
              >
                {icon}
              </span>
              <div className="flex flex-col items-center gap-0.5">
                <h3 className="text-base font-extrabold text-ddp-ink">
                  {tContent(`skills.${skill.id}.name`)}
                </h3>
                <span className={`text-[11px] font-bold ${STATUS_TEXT_CLASS[status]}`}>{statusText}</span>
              </div>
              <p className="text-xs leading-snug text-ddp-ink-muted">
                {tContent(`skills.${skill.id}.desc`)}
              </p>
              <div className="flex w-full flex-col gap-1.5">
                {skillStatParts(skillDef).map((part) => (
                  <div
                    key={part.key}
                    className="flex items-center justify-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-1.5 text-[11px] font-semibold text-ddp-ink"
                  >
                    {tPanels(`skillStat.${part.key}`, part.values)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </ModalPortal>
  );
}
