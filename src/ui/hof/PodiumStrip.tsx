"use client";

/**
 * HOF panel redesign (owner-approved) — replaces the old always-on 2x2
 * `ChampionsSection.tsx` "current champions" grid. The board tabs in
 * `HallOfFamePanel.tsx` are now the SINGLE navigation: selecting a board
 * shows THAT board's podium (rank-1 champion + a "▾ ranks 2-3" reveal)
 * directly above that board's live list, both fed by the ONE
 * `/api/hof/rewards` response (`useHofRewards.ts`) re-keyed per board via
 * `rewardsLogic.ts`'s `resolvePodium` — no extra fetch per tab.
 *
 * Boards outside the seasonal rewards program (boss-time) render NO podium
 * at all (`resolvePodium` returns `{kind:"none"}`).
 *
 * The claim CTA for the viewer's own unclaimed award lives INSIDE the podium
 * of the relevant board (`UnclaimedAwardCta`, moved verbatim from the old
 * `ChampionsSection.tsx` — same idle/claiming/claimed/error state machine
 * mirroring `GameClient.tsx`'s world-boss fortifier claim recipe) AND is
 * separately surfaced via `UnclaimedAwardsBanner` above the tabs so a player
 * who never opens their board still sees it.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { lookupTemplate, type HeroClass } from "@/engine";
import { HERO_ICONS } from "@/ui/labels";
import { postHofClaim } from "@/ui/hof/rewardsApi";
import type { HofChampionRow } from "@/ui/hof/rewardsTypes";
import { claimStateAfterResult, type ClaimState, type PodiumResolution } from "@/ui/hof/rewardsLogic";
import { titleLabel } from "@/ui/hof/titles";
import type { HofBoard } from "@/ui/hof/types";
import { useGameStore } from "@/ui/store/gameStore";

type Translator = ReturnType<typeof useTranslations>;

/** Pre-2020 medal emoji (footgun #4: no Unicode-13+ glyphs on Windows 10). */
const RANK_MEDAL: Record<number, string> = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

/** A single podium row (rank-1 champion OR a revealed rank 2-3 row). Title
 * renders as its OWN line under the name — the bug this replaces had the
 * title span as `shrink-0 truncate` (shrink-0 defeats truncate, so all the
 * squeeze landed on the name instead); stacking name/title on separate lines
 * lets both truncate independently. */
function PodiumRow({ row, highlight, t }: { row: HofChampionRow; highlight?: boolean; t: Translator }) {
  const label = titleLabel(row.titleId, t);
  return (
    <div
      className={`flex items-center gap-2 rounded-(--ddp-radius-md) border px-2.5 py-1.5 text-xs ${
        highlight ? "border-ddp-gold/50 bg-black/30" : "border-ddp-border-soft bg-black/20"
      }`}
    >
      <span aria-hidden className="w-5 shrink-0 text-center">
        {RANK_MEDAL[row.rank] ?? `#${row.rank}`}
      </span>
      <span aria-hidden className="shrink-0">
        {HERO_ICONS[row.cls as HeroClass] ?? ""}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold text-ddp-ink">{row.charName}</div>
        {label && <div className="truncate text-[10px] font-semibold text-ddp-gold-bright">{label}</div>}
      </div>
    </div>
  );
}

function UnclaimedAwardCta({
  awardId,
  titleId,
  t,
}: {
  awardId: string;
  titleId: string;
  t: Translator;
}) {
  const [state, setState] = useState<ClaimState>("idle");

  async function handleClaim() {
    setState("claiming");
    const res = await postHofClaim(awardId);
    const next = claimStateAfterResult(res);
    if (next === "claimed" && res && res.ok) {
      const store = useGameStore.getState();
      store.mergeInventory([res.item]);
      store.pushDropFeed(res.item.templateId, lookupTemplate(res.item.templateId)?.rarity ?? "epic");
      store.pushNotice("hofClaimed");
    }
    setState(next);
    if (next === "error") window.setTimeout(() => setState("idle"), 3000);
  }

  const label = titleLabel(titleId, t) ?? titleId;

  return (
    <div className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/40 bg-ddp-gold/10 px-2.5 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate font-bold text-ddp-gold-bright">{label}</span>
      {state === "claimed" ? (
        <span className="shrink-0 text-[11px] font-bold text-emerald-300">{t("champions.claimed")}</span>
      ) : (
        <button
          type="button"
          onClick={() => void handleClaim()}
          disabled={state === "claiming"}
          className="min-h-9 shrink-0 rounded-(--ddp-radius-md) border border-ddp-gold bg-ddp-gold px-2.5 py-1.5 text-[11px] font-extrabold text-black disabled:opacity-60"
        >
          {state === "claiming" ? t("champions.claiming") : t("champions.claimButton")}
        </button>
      )}
      {state === "error" && (
        <span className="shrink-0 text-[10px] font-semibold text-ddp-bad">{t("champions.claimError")}</span>
      )}
    </div>
  );
}

const BOARD_ICON: Record<HofBoard, string> = {
  level: "\u{1F3C5}", // 🏅
  power: "\u{2694}", // ⚔
  gold: "\u{1F4B0}", // 💰
  boss: "\u{23F1}", // ⏱
  online: "\u{23F3}", // ⏳
};

export interface PodiumStripProps {
  board: HofBoard;
  resolution: PodiumResolution;
  expanded: boolean;
  onToggleExpand: () => void;
  myAward: { awardId: string; titleId: string } | null;
  t: Translator;
}

/** Fixed-height collapsed content zone (rank-1 row OR the empty/no-season
 * message) — same box size across ALL states so switching boards never
 * jitters the panel; the expand toggle + revealed rows extend BELOW this
 * box, an intentional user-triggered size change, not a loading flicker. */
export function PodiumStrip({ board, resolution, expanded, onToggleExpand, myAward, t }: PodiumStripProps) {
  if (resolution.kind === "none") return null;

  return (
    <section className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 p-3">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-ddp-gold-bright uppercase">
        <span aria-hidden>{BOARD_ICON[board]}</span>
        {t("champions.title")} · {t(`boards.${board}`)}
      </h3>

      <div className="flex min-h-11 items-center">
        {resolution.kind === "noSeason" && (
          <p className="text-[11px] text-ddp-ink-muted">{t("champions.noSeason")}</p>
        )}
        {resolution.kind === "empty" && (
          <p className="text-[11px] text-ddp-ink-muted">{t("champions.empty")}</p>
        )}
        {resolution.kind === "ready" && (
          <div className="w-full">
            <PodiumRow row={resolution.champion} highlight t={t} />
          </div>
        )}
      </div>

      {resolution.kind === "ready" && resolution.runnersUp.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggleExpand}
            className="self-start text-[10px] font-semibold text-ddp-ink-muted underline decoration-dotted"
          >
            {expanded ? t("champions.collapseRunnersUp") : t("champions.expandRunnersUp")}
          </button>
          {expanded && (
            <div className="flex flex-col gap-1">
              {resolution.runnersUp.map((r) => (
                <PodiumRow key={r.rank} row={r} t={t} />
              ))}
            </div>
          )}
        </>
      )}

      {myAward && <UnclaimedAwardCta awardId={myAward.awardId} titleId={myAward.titleId} t={t} />}
    </section>
  );
}

export interface UnclaimedAwardsBannerProps {
  count: number;
  onOpen: () => void;
  t: Translator;
}

/** Slim banner above the board tabs, visible regardless of the selected
 * board — the discoverability half of item 1: a player who never opens the
 * board holding their award must still see SOMETHING pointing at it. */
export function UnclaimedAwardsBanner({ count, onOpen, t }: UnclaimedAwardsBannerProps) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/50 bg-ddp-gold/10 px-3 py-2 text-left text-xs font-bold text-ddp-gold-bright"
    >
      <span>{t("champions.unclaimedBanner", { count })}</span>
      <span aria-hidden>{"›"}</span>
    </button>
  );
}
