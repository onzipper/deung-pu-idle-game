"use client";

/**
 * M8 quest Wave C — the Quest Board panel (ผู้ใหญ่บ้าน's dialog). Same
 * `ModalPortal` shell convention as every other HUD modal (iOS Safari
 * backdrop-filter containing-block trap) and the same "town-only claim
 * entry" design decision as `TownNpcPanelHost.tsx`'s other two panels — this
 * is the ONLY place a daily/main-chapter reward can be claimed (the goal
 * card's chapter line is read-only, no claim button there).
 *
 * Two sections, daily-first (design doc §3): เดลี่วันนี้ (up to
 * `CONFIG.dailyQuests.rosterSize` rows, each with its own progress bar + a
 * รับรางวัล button once complete-unclaimed) and เควสหลัก (the current — first
 * not-yet-claimed — chapter, its objective progress, a claim button once
 * complete, and a next-chapter teaser). The bot never reaches this panel at
 * all (town NPC tap-to-talk is player-only for ผู้ใหญ่บ้าน, same as the refine
 * smith) — no bot hooks anywhere in this file.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { DailyObjectiveType, QuestReward } from "@/engine";
import { Coin, MaterialIcon } from "@/ui/components/icons";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { claimDailyQuest } from "@/ui/quest/dailyClaimFlow";
import { useGameStore, type DailyQuestSummary } from "@/ui/store/gameStore";

type Translator = ReturnType<typeof useTranslations>;

/** Pre-2020, Win10-safe icons already shipped elsewhere in the codebase
 * (🗡/👑 in `GoalLadder.tsx`, ⚒ in `RefinePanel.tsx`, 🧪/💰 in existing
 * patch-notes copy) — reused here rather than picking new glyphs. */
const DAILY_ICON: Record<DailyObjectiveType, string> = {
  killAnywhere: "🗡",
  refineOnce: "⚒",
  buyPotions: "🧪",
  spendGold: "💰",
  clearAnyBoss: "👑",
};

/** A reward preview line, shared by both the daily rows and the main-chapter
 * card — every quest reward is gold/materials/potions ONLY (owner taste: no
 * power items), so one renderer covers both. */
function RewardLine({ reward }: { reward: QuestReward }) {
  const parts: React.ReactNode[] = [];
  if (reward.gold) {
    parts.push(
      <span key="gold" className="inline-flex items-center gap-1 text-ddp-gold-bright">
        <Coin className="h-3 w-3" />
        {reward.gold.toLocaleString()}
      </span>,
    );
  }
  if (reward.materials) {
    parts.push(
      <span key="materials" className="inline-flex items-center gap-1 text-violet-300">
        <MaterialIcon className="h-3 w-3" />
        {reward.materials.toLocaleString()}
      </span>,
    );
  }
  if (reward.hpPotion) {
    parts.push(
      <span key="hp" className="text-rose-300">
        ❤ {reward.hpPotion}
      </span>,
    );
  }
  if (reward.manaPotion) {
    parts.push(
      <span key="mp" className="text-sky-300">
        💧 {reward.manaPotion}
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-bold">{parts}</div>;
}

function DailyRow({ quest }: { quest: DailyQuestSummary }) {
  const t = useTranslations("questBoard");
  const tDaily = useTranslations("quest.daily");
  const [claiming, setClaiming] = useState(false);
  const [failed, setFailed] = useState(false);

  const pct = quest.target > 0 ? Math.min(100, (quest.progress / quest.target) * 100) : 0;

  async function handleClaim(): Promise<void> {
    setClaiming(true);
    setFailed(false);
    const result = await claimDailyQuest(quest.id);
    setClaiming(false);
    if (result === "notInRoster" || result === "network") setFailed(true);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-ddp-ink">
          <span aria-hidden>{DAILY_ICON[quest.type]}</span>
          <span className="truncate">{tDaily(`${quest.id}.title`)}</span>
        </span>
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-ddp-ink-muted">
          {Math.min(quest.progress, quest.target)}/{quest.target}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-ddp-ink-muted">
        {tDaily(`${quest.id}.desc`, { count: quest.target })}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-ddp-border-soft ring-inset">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            quest.complete ? "bg-emerald-400" : "bg-ddp-gold"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <RewardLine reward={quest.reward} />
      {quest.claimed ? (
        <span className="text-[11px] font-semibold text-emerald-300">{t("dailyClaimedLabel")}</span>
      ) : quest.complete ? (
        <button
          type="button"
          disabled={claiming}
          onClick={() => void handleClaim()}
          className="min-h-9 w-full rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/15 px-3 text-[11px] font-bold text-emerald-300 transition-transform duration-100 active:scale-[0.98] disabled:opacity-50"
        >
          {claiming ? t("dailyClaiming") : t("dailyClaimButton")}
        </button>
      ) : (
        <span className="text-[11px] text-ddp-ink-muted/70">{t("dailyInProgressHint")}</span>
      )}
      {failed && <span className="text-[11px] font-semibold text-ddp-bad">{t("dailyClaimFailed")}</span>}
    </div>
  );
}

function DailySection({ t }: { t: Translator }) {
  const dailies = useGameStore((s) => s.dailies);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("dailySectionTitle")}
      </h3>
      {dailies.quests.length === 0 ? (
        <p className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 px-3 py-4 text-center text-[12px] text-ddp-ink-muted">
          {t("dailyEmpty")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {dailies.quests.map((q) => (
            <DailyRow key={q.id} quest={q} />
          ))}
        </div>
      )}
    </section>
  );
}

function MainQuestSection({ t }: { t: Translator }) {
  const tQuest = useTranslations("quest.main");
  const tMaps = useTranslations("content.maps");
  const mainChapters = useGameStore((s) => s.mainChapters);
  const world = useGameStore((s) => s.world);
  const kills = useGameStore((s) => s.kills);
  const killGoal = useGameStore((s) => s.killGoal);
  const queueClaimMainReward = useGameStore((s) => s.queueClaimMainReward);

  const activeIdx = mainChapters.findIndex((c) => !c.claimed);

  return (
    <section className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 p-3">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-gold-bright uppercase">
        {t("mainSectionTitle")}
      </h3>
      {activeIdx === -1 ? (
        <p className="py-2 text-center text-[12px] font-semibold text-emerald-300">{t("mainAllDone")}</p>
      ) : (
        (() => {
          const chapter = mainChapters[activeIdx];
          const next = mainChapters[activeIdx + 1] ?? null;
          const mapName = tMaps(`${chapter.mapId}.name`);
          return (
            <>
              <span className="text-[12px] font-bold text-ddp-ink">
                {t("mainChapterLabel", { n: activeIdx + 1, title: tQuest(`${chapter.id}.title`) })}
              </span>
              <p className="text-[11px] leading-snug text-ddp-ink-muted">
                {tQuest(`${chapter.id}.desc`)}
              </p>
              {!chapter.complete && (
                <span className="text-[11px] font-semibold text-sky-200">
                  {world.mapId === chapter.mapId
                    ? t("mainProgressHere", { kills, killGoal })
                    : t("mainProgressElsewhere", { map: mapName })}
                </span>
              )}
              <RewardLine reward={chapter.reward} />
              {chapter.claimable ? (
                <button
                  type="button"
                  onClick={() => queueClaimMainReward(chapter.id)}
                  className="min-h-11 w-full rounded-(--ddp-radius-md) border border-ddp-gold bg-ddp-gold px-3 text-[12px] font-extrabold text-ddp-panel-strong transition-transform duration-100 active:scale-[0.98]"
                >
                  🎁 {t("mainClaimButton")}
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-ddp-ink-muted">
                  {chapter.complete ? t("mainClaimedButton") : t("mainInProgressHint")}
                </span>
              )}
              {next && (
                <span className="text-[11px] text-ddp-ink-muted/70">
                  {t("mainNextChapter", { title: tQuest(`${next.id}.title`) })}
                </span>
              )}
            </>
          );
        })()
      )}
    </section>
  );
}

export function QuestBoardPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("questBoard");
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
        <div className="animate-onboarding-in relative flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-(--ddp-radius-lg) border border-ddp-border bg-ddp-panel-strong p-4 text-ddp-ink shadow-(--ddp-shadow-panel)">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-ddp-gold-bright">🧭 {t("title")}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {t("closeButton")}
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <DailySection t={t} />
            <MainQuestSection t={t} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
