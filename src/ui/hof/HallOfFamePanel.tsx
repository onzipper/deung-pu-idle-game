"use client";

/**
 * M7.95 Hall of Fame — the top-10-per-board leaderboard modal (entry points:
 * the goal card's 🏆 rung in `GoalLadder.tsx`, and `HallOfFameButton` in the
 * console dock's settings row). Same modal-shell conventions as
 * `CodexPanel.tsx`/`InventoryPanel.tsx` (fixed overlay via `ModalPortal`, the
 * sim never pauses behind it).
 *
 * REDESIGN (owner-approved, house style = `FriendsPanel.tsx`/
 * `SettingsPanel.tsx`): the board tabs are the SINGLE navigation. Selecting a
 * board shows THAT board's `PodiumStrip` (rank-1 + a ranks-2-3 reveal, fed by
 * the one `/api/hof/rewards` call via `useHofRewards` — no per-tab fetch)
 * directly above that board's live list. The old always-on 2x2 champions
 * grid (`ChampionsSection.tsx`) is gone.
 *
 * Fetching (task brief): a plain `fetch` on open + whenever the board/stage/
 * class filter changes, no polling. A tiny per-query-key cache (`cacheRef`,
 * session-scoped, not persisted) means flipping back to an already-fetched
 * tab renders INSTANTLY from cache while a background refetch silently swaps
 * in fresher data — no skeleton on revisit. A board/filter never fetched
 * before renders `resolveSkeletonRowCount()` fixed-height skeleton rows
 * instead of collapsing the panel (owner: "กดเปลี่ยน tab แล้ว ui มัน ยึดๆ
 * หดๆ" — tab switches must never stretch/shrink the frame). The modal root
 * uses a FIXED height (not just a cap) so the frame never resizes at all
 * across board switches; only the list zone scrolls internally.
 *
 * An in-flight fetch is aborted the instant the query changes again or the
 * panel closes (`AbortController`), and an aborted request is silently
 * dropped rather than shown as an error (see `api.ts`'s `HofFetchResult`).
 *
 * The backend (`/api/hof`) lands in parallel with this UI wave — a
 * network/non-2xx failure renders `hof.notOpenYet` so this wave is
 * independently testable before the route exists.
 *
 * R2-W4 token pass (visual-only, per `docs/ui-reference-map.md`'s RANKING
 * row): outer shell swapped from a hand-rolled bordered `div` to the
 * `Panel variant="gold"` + `PanelHeader` primitives (same drop-in shape the
 * other R2 panels already use — see `InventoryPanel.tsx`) so the modal frame
 * follows the "gold frame reserved for TOP-LEVEL panels" rule. The board and
 * boss-stage tab strips (both plain id+label(+icon) lists) now render through
 * the real `TabRow` primitive, which carries the token-spec's purple
 * (`--ddp-boss`) active-tab accent — gold stays reserved for numerals/CTAs,
 * not tab chrome. The class-filter row stays a local icon-only component
 * (its fixed-square shape isn't what `Tab` renders) but its active state was
 * recolored to the same purple for consistency. Zero fetch/cache/skeleton/
 * podium logic touched.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { fetchHof } from "@/ui/hof/api";
import { formatBossClearTime, formatPlainValue, splitOnlineSeconds } from "@/ui/hof/format";
import { HofProfileModal } from "@/ui/hof/HofProfileModal";
import { PODIUM_SKELETON_HEIGHT_CLASS, PodiumStrip, UnclaimedAwardsBanner } from "@/ui/hof/PodiumStrip";
import { hofQueryKey } from "@/ui/hof/query";
import {
  hasAnyUnclaimedAward,
  isMyEntry,
  resolveBoardFetchDecision,
  resolveMyUnclaimedForBoard,
  resolvePodium,
  resolveSkeletonRowCount,
  titleForCharInBoard,
} from "@/ui/hof/rewardsLogic";
import { titleLabel } from "@/ui/hof/titles";
import {
  HOF_BOSS_STAGES,
  type HofBoard,
  type HofClassFilter,
  type HofEntry,
  type HofQuery,
  type HofResponse,
} from "@/ui/hof/types";
import { useHofRewards } from "@/ui/hof/useHofRewards";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { Button } from "@/ui/components/primitives/Button";
import { Panel } from "@/ui/components/primitives/Panel";
import { PanelHeader } from "@/ui/components/primitives/PanelHeader";
import { TabRow } from "@/ui/components/primitives/TabRow";
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
/** Icon-only class filter pills (item 3 of the redesign) — "all" gets a
 * generic pre-2020 star glyph since there's no per-class icon for it. */
const CLASS_FILTER_ICON: Record<HofClassFilter, string> = {
  all: "\u{2605}", // ★
  swordsman: HERO_ICONS.swordsman,
  archer: HERO_ICONS.archer,
  mage: HERO_ICONS.mage,
  ninja: HERO_ICONS.ninja,
};
// Pre-2020 medal emoji (footgun #4: no Unicode-13+ glyphs on Windows 10).
const RANK_MEDAL: Record<number, string> = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

type Translator = ReturnType<typeof useTranslations>;

type PanelState =
  | { kind: "skeleton"; rowCount: number }
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

/** Icon-only class-filter pill — kept local (its fixed h-9/w-9 square isn't
 * what the flex-1 `Tab` primitive renders) but recolored to the token spec's
 * purple active accent (`--ddp-boss`), matching `Tab.tsx`. */
function IconTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border text-base transition-colors ${
        active
          ? "border-ddp-boss bg-ddp-boss/20 text-ddp-boss-light"
          : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted"
      }`}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

/** Same fixed-height row shape as a real `RankRow` — rendered in place of the
 * list while a never-fetched board/filter combo is loading, so the panel
 * never collapses to zero height mid-fetch. */
function SkeletonRow() {
  return (
    <div className="flex min-h-11 w-full animate-pulse items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 px-2.5 py-2">
      <span className="h-4 w-6 shrink-0 rounded bg-white/10" />
      <span className="h-4 w-4 shrink-0 rounded bg-white/10" />
      <span className="h-3 flex-1 rounded bg-white/10" />
      <span className="h-3 w-8 shrink-0 rounded bg-white/10" />
      <span className="h-3 w-10 shrink-0 rounded bg-white/10" />
    </div>
  );
}

function RankRow({
  entry,
  board,
  titleId,
  t,
  tCommon,
  onSelect,
}: {
  entry: HofEntry;
  board: HofBoard;
  titleId: string | null;
  t: Translator;
  tCommon: Translator;
  onSelect: () => void;
}) {
  const nameCls = prestigeNameClass(
    Math.max(entry.profile.refineLevels.weapon, entry.profile.refineLevels.armor),
  );
  const value = formatHofValue(board, entry.value, t);
  const title = titleLabel(titleId, t);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-13 w-full items-center gap-2.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-3 py-2.5 text-left transition-transform duration-100 active:scale-[0.98]"
    >
      {/* ONE rank marker only (medal for 1-3, #n otherwise) — the class icon
       * is the only other leading glyph, so the row's left edge never has
       * more than 2 competing icons before the name. */}
      <span aria-hidden className="w-6 shrink-0 text-center text-sm font-black">
        {RANK_MEDAL[entry.rank] ?? `#${entry.rank}`}
      </span>
      <span aria-hidden className="shrink-0 text-sm">
        {HERO_ICONS[entry.cls]}
      </span>
      {/* Name + (optional) title stacked on separate lines, with breathing
       * room between them (leading-snug + a small top margin on the title) —
       * each truncates independently, fixing the old shrink-0/truncate
       * collision where a right-aligned title span squeezed all the room
       * out of the name. */}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-xs leading-snug ${nameCls || "font-bold text-ddp-ink"}`}>{entry.charName}</div>
        {title && (
          <div className="mt-0.5 truncate text-[10px] leading-snug font-semibold text-ddp-gold-bright">{title}</div>
        )}
      </div>
      {/* Level + value get FIXED widths so every row's name column knows its
       * budget regardless of which board's value format is widest (a boss
       * clear time vs. a 6-digit gold total). */}
      <span className="font-display w-10 shrink-0 text-right text-[10px] text-ddp-ink-muted tabular-nums">
        {tCommon("levelBadge", { level: entry.level })}
      </span>
      <span className="font-display w-20 shrink-0 text-right text-xs font-bold text-ddp-gold-bright tabular-nums">
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
  const [state, setState] = useState<PanelState>({ kind: "skeleton", rowCount: resolveSkeletonRowCount() });
  const [selected, setSelected] = useState<HofEntry | null>(null);
  const cacheRef = useRef(new Map<string, HofResponse>());
  const rewards = useHofRewards();

  const query: HofQuery = { board, bossStage, cls };
  const key = hofQueryKey(query);

  function selectBoard(next: HofBoard): void {
    setBoard(next);
  }

  useEffect(() => {
    const cached = cacheRef.current.get(key);
    const decision = resolveBoardFetchDecision(cached, resolveSkeletonRowCount());
    setState(
      decision.kind === "instant"
        ? { kind: "ok", data: decision.data }
        : { kind: "skeleton", rowCount: decision.rowCount },
    );

    const controller = new AbortController();
    fetchHof(query, controller.signal).then((res) => {
      if (res.kind === "aborted") return;
      if (res.kind === "error") {
        // A cached render is already on screen — a background refresh
        // failure stays silent rather than yanking the list to an error
        // state (item 4c: "revisiting a tab... refreshes in the background").
        if (!cached) setState({ kind: "error" });
        return;
      }
      cacheRef.current.set(key, res.data);
      setState({ kind: "ok", data: res.data });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is derived from (board,bossStage,cls) which is exactly `query`'s content — re-running whenever it changes is equivalent to depending on `query` itself.
  }, [key]);

  const rewardsData = rewards.kind === "ok" ? rewards.data : null;
  const unclaimedCount = rewardsData?.me ? rewardsData.me.unclaimedAwards.length : 0;
  const myAwardForBoard = resolveMyUnclaimedForBoard(rewardsData?.me?.unclaimedAwards, board);

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
          className="animate-onboarding-in relative flex h-[min(85vh,42rem)] w-full max-w-lg flex-col gap-3 overflow-hidden sm:max-w-2xl"
        >
          <PanelHeader
            title={t("title")}
            icon={<span aria-hidden>{"\u{1F3C6}"}</span>}
            actions={
              <Button variant="secondary" className="px-2.5 py-1.5 text-[11px]" onClick={onClose}>
                ✕ {t("closeButton")}
              </Button>
            }
          />

          {hasAnyUnclaimedAward(rewardsData?.me) && rewardsData?.me && (
            <UnclaimedAwardsBanner
              count={unclaimedCount}
              onOpen={() => selectBoard(rewardsData.me!.unclaimedAwards[0].board as HofBoard)}
              t={t}
            />
          )}

          {rewards.kind === "loading" && (
            <div
              className={`${PODIUM_SKELETON_HEIGHT_CLASS} shrink-0 animate-pulse rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5`}
            />
          )}
          {rewards.kind === "ok" && (
            <PodiumStrip board={board} resolution={resolvePodium(rewardsData, board)} myAward={myAwardForBoard} t={t} />
          )}

          <TabRow
            className="flex-wrap"
            tabs={BOARD_ORDER.map((b) => ({
              id: b,
              label: t(`boards.${b}`),
              icon: <span aria-hidden>{BOARD_ICON[b]}</span>,
            }))}
            active={board}
            onChange={selectBoard}
          />

          {board === "boss" && (
            <TabRow
              className="flex-wrap"
              tabs={HOF_BOSS_STAGES.map((stage) => ({
                id: String(stage),
                label: t("stageChip", { stage }),
              }))}
              active={String(bossStage)}
              onChange={(id) => setBossStage(Number(id))}
            />
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {CLASS_FILTER_ORDER.map((c) => (
              <IconTabButton
                key={c}
                active={cls === c}
                onClick={() => setCls(c)}
                icon={CLASS_FILTER_ICON[c]}
                label={t(`classFilter.${c}`)}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {state.kind === "skeleton" &&
              Array.from({ length: state.rowCount }).map((_, i) => <SkeletonRow key={i} />)}
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
                  titleId={titleForCharInBoard(rewardsData, board, entry.charName)}
                  t={t}
                  tCommon={tCommon}
                  onSelect={() => setSelected(entry)}
                />
              ))}
          </div>

          <div className="shrink-0 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-3 py-2 text-center text-xs font-semibold text-ddp-ink-muted">
            {state.kind === "ok" && state.data.me
              ? t("myRank", { rank: state.data.me.rank })
              : t("notRanked")}
          </div>
        </Panel>
      </div>

      {selected && (
        <HofProfileModal
          entry={selected}
          isMe={state.kind === "ok" && isMyEntry(state.data.me?.rank, selected.rank)}
          onClose={() => setSelected(null)}
        />
      )}
    </ModalPortal>
  );
}
