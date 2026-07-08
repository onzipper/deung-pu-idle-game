"use client";

/**
 * M7.95 Hall of Fame — the top-10-per-board leaderboard modal (entry points:
 * the goal card's 🏆 rung in `GoalLadder.tsx`, and `HallOfFameButton` in the
 * console dock's settings row). Same modal-shell conventions as
 * `CodexPanel.tsx`/`InventoryPanel.tsx` (fixed overlay via `ModalPortal`, the
 * sim never pauses behind it).
 *
 * Fetching (task brief): a plain `fetch` on open + whenever the board/stage/
 * class filter changes, no polling. A tiny per-query-key cache (`cacheRef`,
 * session-scoped, not persisted) means flipping back to an already-fetched
 * tab never re-hits the network. An in-flight fetch is aborted the instant
 * the query changes again or the panel closes (`AbortController`), and an
 * aborted request is silently dropped rather than shown as an error (see
 * `api.ts`'s `HofFetchResult`).
 *
 * The backend (`/api/hof`) lands in parallel with this UI wave — a
 * network/non-2xx failure renders `hof.notOpenYet` so this wave is
 * independently testable before the route exists.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchHof } from "@/ui/hof/api";
import { formatBossClearTime, formatPlainValue, splitOnlineSeconds } from "@/ui/hof/format";
import { HofProfileModal } from "@/ui/hof/HofProfileModal";
import { hofQueryKey } from "@/ui/hof/query";
import {
  HOF_BOSS_STAGES,
  type HofBoard,
  type HofClassFilter,
  type HofEntry,
  type HofQuery,
  type HofResponse,
} from "@/ui/hof/types";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { HERO_ICONS, prestigeNameClass } from "@/ui/labels";

const BOARD_ORDER: readonly HofBoard[] = ["level", "power", "gold", "boss", "online"];
const BOARD_ICON: Record<HofBoard, string> = {
  level: "\u{1F3C5}", // 🏅
  power: "\u{2694}", // ⚔
  gold: "\u{1F4B0}", // 💰
  boss: "\u{23F1}", // ⏱
  online: "\u{23F3}", // ⏳
};
const CLASS_FILTER_ORDER: readonly HofClassFilter[] = [
  "all",
  "swordsman",
  "archer",
  "mage",
  "ninja",
];
// Pre-2020 medal emoji (footgun #4: no Unicode-13+ glyphs on Windows 10).
const RANK_MEDAL: Record<number, string> = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

type Translator = ReturnType<typeof useTranslations>;

type PanelState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: HofResponse };

/** Composes the per-board display value — the pure numeric pieces live in
 * `format.ts`; only the online board's "ชม./นาที" vs "h/m" phrasing needs the
 * translator, so this stays a plain function here rather than in that
 * i18n-free module. */
function formatHofValue(board: HofBoard, value: number, t: Translator): string {
  if (board === "boss") return formatBossClearTime(value);
  if (board === "online") {
    const { hours, minutes } = splitOnlineSeconds(value);
    return t("onlineValue", { hours, minutes });
  }
  return formatPlainValue(board, value);
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap transition-colors ${
        active
          ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
          : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

function RankRow({
  entry,
  board,
  t,
  tCommon,
  onSelect,
}: {
  entry: HofEntry;
  board: HofBoard;
  t: Translator;
  tCommon: Translator;
  onSelect: () => void;
}) {
  const nameCls = prestigeNameClass(
    Math.max(entry.profile.refineLevels.weapon, entry.profile.refineLevels.armor),
  );
  const value = formatHofValue(board, entry.value, t);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-11 w-full items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-2 text-left transition-transform duration-100 active:scale-[0.98]"
    >
      <span aria-hidden className="w-6 shrink-0 text-center text-sm font-black">
        {RANK_MEDAL[entry.rank] ?? `#${entry.rank}`}
      </span>
      <span aria-hidden className="shrink-0 text-sm">
        {HERO_ICONS[entry.cls]}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${nameCls || "font-bold text-ddp-ink"}`}>
        {entry.charName}
      </span>
      <span className="shrink-0 text-[10px] text-ddp-ink-muted tabular-nums">
        {tCommon("levelBadge", { level: entry.level })}
      </span>
      <span className="shrink-0 text-xs font-bold text-ddp-gold-bright tabular-nums">
        {value}
      </span>
    </button>
  );
}

export interface HallOfFamePanelProps {
  onClose: () => void;
}

export function HallOfFamePanel({ onClose }: HallOfFamePanelProps) {
  const t = useTranslations("hof");
  const tCommon = useTranslations("common");
  const [board, setBoard] = useState<HofBoard>("level");
  const [bossStage, setBossStage] = useState<number>(HOF_BOSS_STAGES[0] ?? 5);
  const [cls, setCls] = useState<HofClassFilter>("all");
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [selected, setSelected] = useState<HofEntry | null>(null);
  const cacheRef = useRef(new Map<string, HofResponse>());

  const query: HofQuery = { board, bossStage, cls };
  const key = hofQueryKey(query);

  useEffect(() => {
    const cached = cacheRef.current.get(key);
    if (cached) {
      setState({ kind: "ok", data: cached });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchHof(query, controller.signal).then((res) => {
      if (res.kind === "aborted") return;
      if (res.kind === "error") {
        setState({ kind: "error" });
        return;
      }
      cacheRef.current.set(key, res.data);
      setState({ kind: "ok", data: res.data });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is derived from (board,bossStage,cls) which is exactly `query`'s content — re-running whenever it changes is equivalent to depending on `query` itself.
  }, [key]);

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
            <h2 className="text-base font-extrabold text-ddp-gold-bright">{t("title")}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
            >
              ✕ {t("closeButton")}
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {BOARD_ORDER.map((b) => (
              <TabButton key={b} active={board === b} onClick={() => setBoard(b)}>
                <span aria-hidden>{BOARD_ICON[b]}</span>
                {t(`boards.${b}`)}
              </TabButton>
            ))}
          </div>

          {board === "boss" && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {HOF_BOSS_STAGES.map((stage) => (
                <TabButton
                  key={stage}
                  active={bossStage === stage}
                  onClick={() => setBossStage(stage)}
                >
                  {t("stageChip", { stage })}
                </TabButton>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {CLASS_FILTER_ORDER.map((c) => (
              <TabButton key={c} active={cls === c} onClick={() => setCls(c)}>
                {t(`classFilter.${c}`)}
              </TabButton>
            ))}
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
            {state.kind === "loading" && (
              <p className="py-4 text-center text-xs text-ddp-ink-muted">{t("loading")}</p>
            )}
            {state.kind === "error" && (
              <p className="py-4 text-center text-xs text-ddp-ink-muted">{t("notOpenYet")}</p>
            )}
            {state.kind === "ok" && state.data.top.length === 0 && (
              <p className="py-4 text-center text-xs text-ddp-ink-muted">{t("empty")}</p>
            )}
            {state.kind === "ok" &&
              state.data.top.map((entry) => (
                <RankRow
                  key={entry.rank}
                  entry={entry}
                  board={board}
                  t={t}
                  tCommon={tCommon}
                  onSelect={() => setSelected(entry)}
                />
              ))}
          </div>

          <div className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-3 py-2 text-center text-xs font-semibold text-ddp-ink-muted">
            {state.kind === "ok" && state.data.me
              ? t("myRank", { rank: state.data.me.rank })
              : t("notRanked")}
          </div>
        </div>
      </div>

      {selected && <HofProfileModal entry={selected} onClose={() => setSelected(null)} />}
    </ModalPortal>
  );
}
