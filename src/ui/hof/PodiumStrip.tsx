"use client";

/**
 * HOF podium STAGE (owner-approved redesign, replaces the rank-1-row +
 * "▾ ranks 2-3" expand/collapse from the first PodiumStrip pass — owner
 * verdict: the collapsed row "ไม่ค่อยพิเศษเลย" / not special enough). Three
 * fixed slots ALWAYS render — 2 | 1 | 3 like a real prize podium — fed by the
 * ONE `/api/hof/rewards` response re-keyed per board via `rewardsLogic.ts`'s
 * `resolvePodium` (no extra fetch per tab, unchanged). A short board (fewer
 * than 3 champions crowned) leaves the missing slot(s) as an engraved
 * placeholder — the layout never shifts, no expand state exists anymore.
 *
 * FIXED HEIGHT by construction: every slot (champion/side, real or
 * placeholder) uses an explicit height class (`PODIUM_CHAMPION_H`/
 * `PODIUM_SIDE_H`), and the `noSeason`/`empty` messages render inside a
 * wrapper sized to the SAME total footprint — so switching between boards
 * (ready vs noSeason vs empty, or a full vs. short board) never jitters the
 * panel (the tab-switch stability `HallOfFamePanel.tsx` already shipped).
 * Boss board still renders no podium at all (`resolvePodium` → `{kind:
 * "none"}`) — `PodiumStrip` returns `null` before any of this runs.
 *
 * Responsive stacking (owner spec, ≤420px): the champion card goes full-width
 * on top, ranks 2/3 sit as two half-width cards beneath — same fixed height
 * budget, just re-flowed via one `max-[420px]:` breakpoint (a plain media
 * query; the panel is already near-viewport-width on real phones, no
 * container-query machinery needed here).
 *
 * The claim CTA for the viewer's own unclaimed award now lives on the
 * SPECIFIC slot it belongs to (`rankFromTitleId` parses the rank out of the
 * structural `"<board>.<rank>"` title id) rather than always anchored below
 * the strip — same idle/claiming/claimed/error state machine as before,
 * mirroring `GameClient.tsx`'s world-boss fortifier claim recipe. The
 * separate `UnclaimedAwardsBanner` above the tabs (own file export, unchanged)
 * still catches a player who never opens the board holding their award.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { lookupTemplate, type HeroClass } from "@/engine";
import { HERO_ICONS } from "@/ui/labels";
import { postHofClaim } from "@/ui/hof/rewardsApi";
import type { HofChampionRow } from "@/ui/hof/rewardsTypes";
import { claimStateAfterResult, rankFromTitleId, type ClaimState, type PodiumResolution } from "@/ui/hof/rewardsLogic";
import { titleLabel } from "@/ui/hof/titles";
import type { HofBoard } from "@/ui/hof/types";
import { useGameStore } from "@/ui/store/gameStore";

type Translator = ReturnType<typeof useTranslations>;

/** Pre-2020 crown + medal emoji (footgun #4: no Unicode-13+ glyphs on Windows 10). */
const CROWN = "\u{1F451}"; // 👑
const RANK_MEDAL: Record<number, string> = { 1: CROWN, 2: "\u{1F948}", 3: "\u{1F949}" };

/** Fixed per-slot heights (see module doc: "FIXED HEIGHT by construction") —
 * every real card AND its placeholder counterpart share these exactly, so a
 * short/empty board never changes the podium's total footprint. */
const CHAMPION_H = "h-44"; // 11rem / 176px — crown, name (2-line room), full title, optional CTA
const SIDE_H = "h-32"; // 8rem / 128px — medal, name, small title, optional CTA
/** The whole strip's content-zone height: one row on desktop (tallest cell =
 * champion), two stacked rows + gap on mobile (≤420px). Applied to BOTH the
 * real podium grid and the noSeason/empty message wrapper so every
 * resolution kind occupies the identical box. */
const STAGE_ZONE_H = "h-44 max-[420px]:h-[19.5rem]";

/** Header line + gap + `STAGE_ZONE_H` + the section's own `p-3` padding —
 * exported so `HallOfFamePanel.tsx` can size the OUTER "rewards still
 * loading" skeleton (a separate, one-time loading state that wraps this
 * whole strip and renders before it exists at all) to the same total
 * footprint, so that loading→ready transition doesn't jitter either. */
export const PODIUM_SKELETON_HEIGHT_CLASS = "h-56 max-[420px]:h-[22.5rem]";

function UnclaimedAwardCta({
  awardId,
  titleId,
  compact,
  t,
}: {
  awardId: string;
  titleId: string;
  compact?: boolean;
  t: Translator;
}) {
  const [state, setState] = useState<ClaimState>("idle");
  const tContentItems = useTranslations("content.items");

  async function handleClaim() {
    setState("claiming");
    const res = await postHofClaim(awardId);
    const next = claimStateAfterResult(res);
    if (next === "claimed" && res && res.ok) {
      const store = useGameStore.getState();
      store.mergeInventory([res.item]);
      store.pushDropFeed(res.item.templateId, lookupTemplate(res.item.templateId)?.rarity ?? "epic");
      // Name WHICH fortifier landed (the toast used to just say "claimed!"
      // with no indication of where the reward went) — the first-ever claim
      // is separately taught by the `fortifierGained` contextual tip
      // (`ui/onboarding/tips.ts`); this toast covers every claim after that.
      store.pushNotice("hofClaimed", { item: tContentItems(`${res.item.templateId}.name`) });
    }
    setState(next);
    if (next === "error") window.setTimeout(() => setState("idle"), 3000);
  }

  const label = titleLabel(titleId, t) ?? titleId;

  return (
    <div
      className={`flex w-full items-center justify-center gap-1.5 rounded-(--ddp-radius-md) border border-ddp-gold/40 bg-ddp-gold/10 ${compact ? "px-1.5 py-1 text-[9px]" : "px-2.5 py-1.5 text-[10px]"}`}
    >
      {state === "claimed" ? (
        <span className="font-bold text-emerald-300">{t("champions.claimed")}</span>
      ) : (
        <button
          type="button"
          onClick={() => void handleClaim()}
          disabled={state === "claiming"}
          title={label}
          className={`min-h-7 shrink-0 rounded-(--ddp-radius-md) border border-ddp-gold bg-ddp-gold font-extrabold text-black disabled:opacity-60 ${compact ? "px-1.5 py-1" : "px-2.5 py-1.5"}`}
        >
          {state === "claiming" ? t("champions.claiming") : t("champions.claimButton")}
        </button>
      )}
      {state === "error" && <span className="font-semibold text-ddp-bad">{t("champions.claimError")}</span>}
    </div>
  );
}

interface SlotAward {
  awardId: string;
  titleId: string;
}

/** Center slot — bigger, elevated, crowned, gold breathing-glow border. Name
 * wraps to a 2nd line rather than truncating (owner spec); title gets the
 * same 2-line room. `line-clamp-2` caps BOTH at 2 lines so the fixed
 * `CHAMPION_H` box can never overflow regardless of name/title length. */
function ChampionCard({ row, award, t }: { row: HofChampionRow; award: SlotAward | null; t: Translator }) {
  const label = titleLabel(row.titleId, t);
  return (
    <div
      className={`animate-ddp-podium-glow ${CHAMPION_H} flex flex-col items-center justify-between gap-1 overflow-hidden rounded-(--ddp-radius-md) border-2 border-ddp-gold bg-gradient-to-b from-ddp-gold/15 to-black/30 px-2.5 py-2.5 text-center`}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1">
        <span aria-hidden className="text-2xl leading-none">
          {CROWN}
        </span>
        <span aria-hidden className="text-xl leading-none">
          {HERO_ICONS[row.cls as HeroClass] ?? ""}
        </span>
        <div className="line-clamp-2 text-sm leading-snug font-extrabold text-ddp-ink">{row.charName}</div>
        {label && (
          <div className="line-clamp-2 text-[11px] leading-snug font-semibold text-ddp-gold-bright">{label}</div>
        )}
      </div>
      {award && <UnclaimedAwardCta awardId={award.awardId} titleId={award.titleId} t={t} />}
    </div>
  );
}

/** Side slot (rank 2/3) — smaller, `items-end` on the parent grid seats it
 * lower than the champion card without any manual offset math. */
function SideCard({ row, award, t }: { row: HofChampionRow; award: SlotAward | null; t: Translator }) {
  const label = titleLabel(row.titleId, t);
  return (
    <div
      className={`${SIDE_H} flex flex-col items-center justify-between gap-1 overflow-hidden rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 px-2 py-2 text-center`}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5">
        <span aria-hidden className="text-lg leading-none">
          {RANK_MEDAL[row.rank] ?? `#${row.rank}`}
        </span>
        <span aria-hidden className="text-sm leading-none">
          {HERO_ICONS[row.cls as HeroClass] ?? ""}
        </span>
        <div className="w-full truncate text-xs font-bold text-ddp-ink">{row.charName}</div>
        {label && <div className="w-full truncate text-[9px] font-semibold text-ddp-gold-bright">{label}</div>}
      </div>
      {award && <UnclaimedAwardCta awardId={award.awardId} titleId={award.titleId} compact t={t} />}
    </div>
  );
}

/** Missing rank (short board) — an engraved placeholder that reserves the
 * EXACT same slot height as its real counterpart so the layout never shifts
 * once a 2nd/3rd champion eventually gets crowned. */
function EmptySlot({ rank, champion, t }: { rank: 2 | 3; champion: boolean; t: Translator }) {
  return (
    <div
      className={`${champion ? CHAMPION_H : SIDE_H} flex flex-col items-center justify-center gap-1 rounded-(--ddp-radius-md) border border-dashed border-ddp-border-soft/50 bg-black/10 text-center opacity-50`}
    >
      <span aria-hidden className="text-lg leading-none">
        {RANK_MEDAL[rank]}
      </span>
      <span className="text-[10px] font-semibold text-ddp-ink-muted">{t("champions.podiumEmpty")}</span>
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
  myAward: SlotAward | null;
  t: Translator;
}

/** Which fixed slot (if any) the viewer's own unclaimed award belongs on —
 * `null` when there's no award for this board, or the award's rank doesn't
 * match this slot. */
function awardForRank(myAward: SlotAward | null, rank: number): SlotAward | null {
  if (!myAward) return null;
  return rankFromTitleId(myAward.titleId) === rank ? myAward : null;
}

export function PodiumStrip({ board, resolution, myAward, t }: PodiumStripProps) {
  if (resolution.kind === "none") return null;

  return (
    <section className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 p-3">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-ddp-gold-bright uppercase">
        <span aria-hidden>{BOARD_ICON[board]}</span>
        {t("champions.title")} · {t(`boards.${board}`)}
      </h3>

      {(resolution.kind === "noSeason" || resolution.kind === "empty") && (
        <div className={`flex ${STAGE_ZONE_H} items-center justify-center px-4 text-center`}>
          <p className="text-[11px] text-ddp-ink-muted">
            {resolution.kind === "noSeason" ? t("champions.noSeason") : t("champions.empty")}
          </p>
        </div>
      )}

      {resolution.kind === "ready" && (
        <div className="grid grid-cols-3 items-end gap-2 max-[420px]:grid-cols-2">
          <div className="order-1 max-[420px]:order-2 max-[420px]:col-start-1 max-[420px]:row-start-2">
            {resolution.rank2 ? (
              <SideCard row={resolution.rank2} award={awardForRank(myAward, 2)} t={t} />
            ) : (
              <EmptySlot rank={2} champion={false} t={t} />
            )}
          </div>
          <div className="order-2 max-[420px]:order-1 max-[420px]:col-span-2 max-[420px]:row-start-1">
            <ChampionCard row={resolution.rank1} award={awardForRank(myAward, 1)} t={t} />
          </div>
          <div className="order-3 max-[420px]:order-3 max-[420px]:col-start-2 max-[420px]:row-start-2">
            {resolution.rank3 ? (
              <SideCard row={resolution.rank3} award={awardForRank(myAward, 3)} t={t} />
            ) : (
              <EmptySlot rank={3} champion={false} t={t} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export interface UnclaimedAwardsBannerProps {
  count: number;
  onOpen: () => void;
  t: Translator;
}

/** Slim banner above the board tabs, visible regardless of the selected
 * board — the discoverability half of the redesign: a player who never opens
 * the board holding their award must still see SOMETHING pointing at it. */
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
