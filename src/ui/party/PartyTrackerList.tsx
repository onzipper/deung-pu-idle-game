"use client";

/**
 * R2.6 quest-tracker Wave 1 — the "ปาร์ตี้" tab's read-only member list.
 * Presentational: reads `s.party` (kept live by the always-mounted
 * `FriendsButton`'s `useFriendsPoll` — see that hook's doc), no polling of
 * its own. Party MANAGEMENT (invite/respond/leave/promote) still lives
 * ENTIRELY in `FriendsPanel.tsx` — the footer "จัดการปาร์ตี้" button just
 * requests that panel open via `openFriendsSignal.ts` (clone of
 * `openSettingsSignal.ts`'s idiom), the same "duplicate entrance, one owner"
 * shape as the old Hall-of-Fame rung shortcut into `HallOfFamePanel`.
 */

import { useTranslations } from "next-intl";
import type { HeroClass } from "@/engine";
import { titleLabel } from "@/ui/hof/titles";
import { HERO_ICONS } from "@/ui/labels";
import { requestOpenFriendsPanel } from "@/ui/openFriendsSignal";
import { useGameStore } from "@/ui/store/gameStore";
import type { PartyMemberWire } from "@/ui/friends/types";

/** Windows-10-safe leader marker (footgun #4: pre-2020 glyphs only) — same
 *  glyph `FriendsPanel.tsx`'s party rows use. */
const LEADER_GLYPH = "★";

function TitleChip({ title, champion }: { title: string | null; champion: boolean }) {
  const tHof = useTranslations("hof");
  const label = titleLabel(title, tHof);
  if (!label) return null;
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
        champion
          ? "border-ddp-gold bg-ddp-gold/20 text-ddp-gold-bright"
          : "border-ddp-border-soft bg-black/30 text-ddp-ink-muted"
      }`}
    >
      {label}
    </span>
  );
}

function PartyMemberRow({ member, isLeader }: { member: PartyMemberWire; isLeader: boolean }) {
  const t = useTranslations("ladder.party");
  const tFriends = useTranslations("friends");
  const tCommon = useTranslations("common");
  const tContent = useTranslations("content");
  const cls = member.currentCharacter?.class as HeroClass | undefined;
  const name = member.displayName ?? tFriends("unknownPlayer");

  return (
    <div className="flex min-h-11 items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-2">
      <span
        aria-label={member.online ? t("onlineLabel") : t("offlineLabel")}
        className={`h-2 w-2 shrink-0 rounded-full ${member.online ? "bg-emerald-400" : "bg-ddp-ink-muted/50"}`}
      />
      {isLeader && (
        <span aria-label={tFriends("partyLeaderBadge")} className="shrink-0 text-xs text-ddp-gold-bright">
          {LEADER_GLYPH}
        </span>
      )}
      {cls && (
        <span aria-hidden className="shrink-0 text-sm">
          {HERO_ICONS[cls] ?? ""}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-bold text-ddp-ink">{name}</span>
      <TitleChip title={member.title} champion={member.champion} />
      {member.currentCharacter ? (
        <span className="shrink-0 text-[10px] text-ddp-ink-muted tabular-nums">
          {cls && `${tContent(`classes.${cls}.name`)} · `}
          {tCommon("levelBadge", { level: member.currentCharacter.level })}
        </span>
      ) : (
        <span className="shrink-0 text-[10px] text-ddp-ink-muted">{tFriends("noCharacter")}</span>
      )}
    </div>
  );
}

function ManageButton() {
  const t = useTranslations("ladder.party");
  return (
    <button
      type="button"
      onClick={requestOpenFriendsPanel}
      className="min-h-11 w-full rounded-(--ddp-radius-md) border border-ddp-boss/50 bg-ddp-boss/15 px-3 text-[12px] font-bold text-ddp-boss-light transition-transform duration-100 active:scale-[0.98]"
    >
      🤝 {t("manageButton")}
    </button>
  );
}

export function PartyTrackerList() {
  const party = useGameStore((s) => s.party);
  const t = useTranslations("ladder.party");

  if (!party) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-semibold text-ddp-ink-muted">{t("empty")}</p>
        <p className="text-[11px] text-ddp-ink-muted/70">{t("emptyHint")}</p>
        <ManageButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {party.members.map((member) => (
        <PartyMemberRow key={member.userId} member={member} isLeader={member.userId === party.leaderUserId} />
      ))}
      <ManageButton />
    </div>
  );
}
