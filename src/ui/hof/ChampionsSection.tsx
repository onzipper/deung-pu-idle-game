"use client";

/**
 * HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — the
 * "แชมป์ประจำเดือน" (current champions) section mounted at the top of
 * `HallOfFamePanel.tsx`. Own one-shot fetch of `GET /api/hof/rewards`
 * (same "mount fetch, no polling" idiom as `AccountSection.tsx`), independent
 * of the panel's per-board `/api/hof` cache below it — cheap read, and the
 * lazy-finalize side effect (closing last month's season on the first request
 * past the cutoff) is intended to ride on it.
 *
 * The claim CTA is a small local state machine (idle -> claiming -> claimed |
 * error) per `awardId`; a successful claim applies the SAME "mint into the
 * inventory + drop-feed toast + notice" recipe `GameClient.tsx`'s
 * `attemptWorldBossClaim` uses for the world-boss fortifier (mirrored here
 * rather than imported since that one is a fire-and-forget background flow
 * driven off an engine event, this one is a direct user tap).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { lookupTemplate, type HeroClass } from "@/engine";
import { HERO_ICONS } from "@/ui/labels";
import { fetchHofRewards, postHofClaim } from "@/ui/hof/rewardsApi";
import type { HofChampionRow, HofRewardsWire } from "@/ui/hof/rewardsTypes";
import { claimStateAfterResult, type ClaimState } from "@/ui/hof/rewardsLogic";
import { HOF_REWARD_BOARDS, titleLabel } from "@/ui/hof/titles";
import { useGameStore } from "@/ui/store/gameStore";

type Translator = ReturnType<typeof useTranslations>;

/** Pre-2020 medal emoji (footgun #4: no Unicode-13+ glyphs on Windows 10) —
 * mirrors `HallOfFamePanel.tsx`'s own `RANK_MEDAL` table. */
const RANK_MEDAL: Record<number, string> = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

type FetchState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: HofRewardsWire };

function ChampionRow({ row, t }: { row: HofChampionRow; t: Translator }) {
  const label = titleLabel(row.titleId, t);
  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-1.5 text-xs">
      <span aria-hidden className="w-5 shrink-0 text-center">
        {RANK_MEDAL[row.rank] ?? `#${row.rank}`}
      </span>
      <span aria-hidden className="shrink-0">
        {HERO_ICONS[row.cls as HeroClass] ?? ""}
      </span>
      <span className="min-w-0 flex-1 truncate font-bold text-ddp-ink">{row.charName}</span>
      {label && (
        <span className="shrink-0 truncate text-[11px] font-bold text-ddp-gold-bright">
          {label}
        </span>
      )}
    </div>
  );
}

function BoardChampions({ board, rows, t }: { board: string; rows: HofChampionRow[]; t: Translator }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t(`boards.${board}`)}
      </h4>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-ddp-ink-muted">{t("champions.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <ChampionRow key={`${board}-${r.rank}`} row={r} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function UnclaimedAwardCta({
  awardId,
  board,
  titleId,
  t,
}: {
  awardId: string;
  board: string;
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
      <span className="min-w-0 flex-1 truncate font-bold text-ddp-gold-bright">
        {t(`boards.${board}`)} · {label}
      </span>
      {state === "claimed" ? (
        <span className="shrink-0 text-[11px] font-bold text-emerald-300">
          {t("champions.claimed")}
        </span>
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
        <span className="shrink-0 text-[10px] font-semibold text-ddp-bad">
          {t("champions.claimError")}
        </span>
      )}
    </div>
  );
}

export function ChampionsSection() {
  const t = useTranslations("hof");
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHofRewards(null, controller.signal).then((res) => {
      if (res.kind === "aborted") return;
      if (res.kind === "error") {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ok", data: res.data });
    });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") {
    return <p className="py-2 text-center text-[11px] text-ddp-ink-muted">{t("loading")}</p>;
  }
  if (state.kind === "error") {
    return <p className="py-2 text-center text-[11px] text-ddp-ink-muted">{t("notOpenYet")}</p>;
  }

  const { data } = state;

  return (
    <section className="flex flex-col gap-3 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 p-3">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-gold-bright uppercase">
        {t("champions.title")}
      </h3>
      {data.season === null ? (
        <p className="text-[11px] text-ddp-ink-muted">{t("champions.noSeason")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {HOF_REWARD_BOARDS.map((board) => (
              <BoardChampions key={board} board={board} rows={data.champions[board]} t={t} />
            ))}
          </div>
          {data.me && data.me.unclaimedAwards.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-ddp-gold/20 pt-2">
              <h4 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
                {t("champions.myUnclaimed")}
              </h4>
              {data.me.unclaimedAwards.map((a) => (
                <UnclaimedAwardCta
                  key={a.awardId}
                  awardId={a.awardId}
                  board={a.board}
                  titleId={a.titleId}
                  t={t}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
