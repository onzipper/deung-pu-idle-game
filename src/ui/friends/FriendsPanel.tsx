"use client";

/**
 * M8 Phase 1 "Friends" — the panel modal. Presentational: ALL polling/mutation
 * state lives in `useFriendsPoll` (owned by `FriendsButton.tsx`, the hub) and
 * is threaded down as props so the badge/toasts/panel never run three
 * independent pollers. Same `ModalPortal` shell convention as every other HUD
 * modal (`HallOfFamePanel.tsx`, `SettingsPanel.tsx`, mandatory per-project
 * rule — iOS Safari's backdrop-filter containing-block trap).
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { HeroClass } from "@/engine";
import { HERO_ICONS } from "@/ui/labels";
import { ModalPortal } from "@/ui/components/ModalPortal";
import { useGameStore } from "@/ui/store/gameStore";
import { FRIEND_EMOJI_ALLOWLIST } from "@/ui/friends/types";
import type {
  FriendCandidateWire,
  FriendWire,
  IncomingPartyInviteWire,
  PartyMemberWire,
  PartyWire,
} from "@/ui/friends/types";
import { parseFriendZone, relativeTimeFrom } from "@/ui/friends/format";
import type { UseFriendsPoll } from "@/ui/friends/useFriendsPoll";
import { requestOpenAccountSettings } from "@/ui/openSettingsSignal";
import { isZoneUnlockedUi } from "@/ui/world/zones";

type Translator = ReturnType<typeof useTranslations>;

/** Mirror of the server's MAX_PARTY_SIZE — the "have room" gate for the invite CTA. */
const MAX_PARTY_SIZE = 6;

/** Windows-10-safe leader marker (footgun #4: pre-2020 glyphs only). */
const LEADER_GLYPH = "★"; // ★

const ERROR_KEY_BY_CODE: Record<string, string> = {
  account_required: "errorAccountRequired",
  not_found: "errorNotFound",
  self: "errorSelf",
  already_friends: "errorAlreadyFriends",
  already_pending: "errorAlreadyPending",
  too_many_pending: "errorTooManyPending",
  bad_emoji: "errorBadEmoji",
  not_friends: "errorNotFriends",
  rate_limited: "errorRateLimited",
  party_full: "errorPartyFull",
  already_member: "errorAlreadyMember",
  already_invited: "errorAlreadyInvited",
  already_in_party: "errorAlreadyInParty",
};

function errorMessage(code: string, t: Translator): string {
  return t(ERROR_KEY_BY_CODE[code] ?? "errorGeneric");
}

function zoneLabelFor(composite: string | null, tFriends: Translator, tWorld: Translator, tMaps: Translator): string {
  const parsed = parseFriendZone(composite);
  if (!parsed) return composite ?? tFriends("unknownZone");
  const mapName = tMaps(`${parsed.mapId}.name`);
  const zoneLabel =
    parsed.kind === "town"
      ? tWorld("zoneTown")
      : parsed.kind === "boss"
        ? tWorld("zoneBoss")
        : tWorld("zoneFarm", { stage: parsed.stage });
  return `${mapName} · ${zoneLabel}`;
}

function lastSeenLabel(lastSeenAt: string | null, t: Translator): string {
  if (!lastSeenAt) return t("neverSeen");
  const rt = relativeTimeFrom(Date.now(), lastSeenAt);
  if (rt.unit === "justNow") return t("lastSeenJustNow");
  if (rt.unit === "minutes") return t("lastSeenMinutes", { m: rt.value });
  if (rt.unit === "hours") return t("lastSeenHours", { h: rt.value });
  return t("lastSeenDays", { d: rt.value });
}

export interface FriendsPanelProps {
  onClose: () => void;
  poll: UseFriendsPoll;
}

export function FriendsPanel({ onClose, poll }: FriendsPanelProps) {
  const t = useTranslations("friends");
  const tWorld = useTranslations("world");
  const tMaps = useTranslations("content.maps");
  const tContent = useTranslations("content.classes");
  const tCommon = useTranslations("common");

  const { status, panel } = poll;

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

          {status === "loading" && (
            <p className="py-6 text-center text-xs text-ddp-ink-muted">{t("loading")}</p>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-xs text-ddp-ink-muted">{t("loadError")}</p>
              <button
                type="button"
                onClick={poll.refresh}
                className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-3 py-2 text-xs font-bold text-ddp-ink"
              >
                {t("retryButton")}
              </button>
            </div>
          )}

          {status === "guest" && (
            <div className="flex flex-col gap-3 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-3">
              <p className="text-[12px] leading-snug text-ddp-ink-muted">{t("guestPitch")}</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  requestOpenAccountSettings();
                }}
                className="min-h-11 rounded-(--ddp-radius-md) border border-emerald-400 bg-emerald-400 px-3 py-2.5 text-sm font-extrabold text-emerald-950 shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.98]"
              >
                {t("guestCta")}
              </button>
            </div>
          )}

          {status === "ready" && panel && (
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {panel.party && (
                <PartySection
                  party={panel.party}
                  poll={poll}
                  t={t}
                  tWorld={tWorld}
                  tMaps={tMaps}
                  tContent={tContent}
                  tCommon={tCommon}
                  onWarp={onClose}
                />
              )}

              {panel.incomingPartyInvites.length > 0 && (
                <PartyInvitesSection invites={panel.incomingPartyInvites} poll={poll} t={t} />
              )}

              <AddFriendSection poll={poll} t={t} />

              {panel.incomingRequests.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
                    {t("incomingGroupTitle")}
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {panel.incomingRequests.map((r) => (
                      <div
                        key={r.requestId}
                        className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ddp-ink">
                          {r.fromDisplayName ?? r.fromFriendCode ?? t("unknownPlayer")}
                        </span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => void poll.respond(r.requestId, true)}
                            className="min-h-9 rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300"
                          >
                            {t("acceptButton")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void poll.respond(r.requestId, false)}
                            className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-2.5 py-1.5 text-[11px] font-bold text-ddp-bad"
                          >
                            {t("declineButton")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
                  {t("friendsGroupTitle")}
                </h3>
                {panel.friends.length === 0 ? (
                  <p className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 px-3 py-4 text-center text-[12px] text-ddp-ink-muted">
                    {t("emptyFriends")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {panel.friends.map((f) => (
                      <FriendRow
                        key={f.userId}
                        friend={f}
                        poll={poll}
                        // I can invite when I have room (no party, or party < 3) and
                        // this friend is online and not already a member of my party.
                        canInvite={
                          f.online &&
                          (!panel.party || panel.party.members.length < MAX_PARTY_SIZE) &&
                          !(panel.party?.members.some((m) => m.userId === f.userId) ?? false)
                        }
                        t={t}
                        tWorld={tWorld}
                        tMaps={tMaps}
                        tContent={tContent}
                        tCommon={tCommon}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function AddFriendSection({ poll, t }: { poll: UseFriendsPoll; t: Translator }) {
  const [friendCode, setFriendCode] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FriendCandidateWire[] | null>(null);

  async function submit(input: { friendCode: string } | { characterName: string }) {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const res = await poll.sendRequest(input);
    setSubmitting(false);
    if (res.ok) {
      setCandidates(null);
      setFriendCode("");
      setCharacterName("");
      setNotice(res.autoAccepted ? t("autoAccepted") : t("requestSent"));
      return;
    }
    if (res.code === "multiple_matches") {
      setCandidates(res.candidates);
      return;
    }
    setCandidates(null);
    setError(errorMessage(res.code, t));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (friendCode.trim()) void submit({ friendCode: friendCode.trim() });
    else if (characterName.trim()) void submit({ characterName: characterName.trim() });
  }

  const canSubmit = (friendCode.trim().length > 0 || characterName.trim().length > 0) && !submitting;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("addFriendGroupTitle")}
      </h3>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-3"
      >
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ddp-ink-muted">
          {t("byCodeLabel")}
          <input
            type="text"
            value={friendCode}
            onChange={(e) => {
              setFriendCode(e.target.value.toUpperCase());
              setCharacterName("");
            }}
            maxLength={16}
            placeholder={t("byCodePlaceholder")}
            className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-mono font-bold tracking-wider text-ddp-ink outline-none focus:border-emerald-400"
          />
        </label>
        <div className="flex items-center gap-2 text-[10px] font-semibold text-ddp-ink-muted">
          <div className="h-px flex-1 bg-ddp-border-soft" />
          {t("orDivider")}
          <div className="h-px flex-1 bg-ddp-border-soft" />
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ddp-ink-muted">
          {t("byNameLabel")}
          <input
            type="text"
            value={characterName}
            onChange={(e) => {
              setCharacterName(e.target.value);
              setFriendCode("");
            }}
            maxLength={24}
            placeholder={t("byNamePlaceholder")}
            className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400"
          />
        </label>

        {error && (
          <span className="rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-2 text-[12px] font-semibold text-ddp-bad">
            {error}
          </span>
        )}
        {notice && (
          <span className="rounded-(--ddp-radius-md) border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-[12px] font-semibold text-emerald-300">
            {notice}
          </span>
        )}

        {candidates && candidates.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 p-2">
            <span className="text-[11px] font-semibold text-ddp-ink-muted">{t("multipleMatchesPrompt")}</span>
            {candidates.map((c) => (
              <button
                key={c.friendCode}
                type="button"
                onClick={() => void submit({ friendCode: c.friendCode })}
                className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2.5 py-2 text-left text-xs"
              >
                <span aria-hidden>{HERO_ICONS[c.class as HeroClass] ?? ""}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ddp-ink">{c.characterName}</span>
                <span className="shrink-0 text-[10px] text-ddp-ink-muted">Lv.{c.level}</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={`min-h-11 rounded-(--ddp-radius-md) border px-3 py-2 text-sm font-extrabold transition-all duration-100 active:translate-y-0.5 active:scale-[0.98] ${
            canSubmit
              ? "border-emerald-400 bg-emerald-400 text-emerald-950"
              : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
          }`}
        >
          {submitting ? t("sending") : t("sendButton")}
        </button>
      </form>
    </section>
  );
}

function FriendRow({
  friend,
  poll,
  canInvite,
  t,
  tWorld,
  tMaps,
  tContent,
  tCommon,
}: {
  friend: FriendWire;
  poll: UseFriendsPoll;
  canInvite: boolean;
  t: Translator;
  tWorld: Translator;
  tMaps: Translator;
  tContent: Translator;
  tCommon: Translator;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  async function handleSendEmoji(emoji: string) {
    setPickerOpen(false);
    const res = await poll.sendEmoji(friend.userId, emoji);
    if (!res.ok) {
      setActionError(errorMessage(res.code, t));
      window.setTimeout(() => setActionError(null), 3000);
    }
  }

  async function handleInvite() {
    setInviting(true);
    setActionError(null);
    const res = await poll.invitePartyMember(friend.userId);
    setInviting(false);
    if (res.ok) {
      setInviteNotice(t("partyInviteSent"));
      window.setTimeout(() => setInviteNotice(null), 3000);
    } else {
      setActionError(errorMessage(res.code, t));
      window.setTimeout(() => setActionError(null), 3000);
    }
  }

  async function handleRemove() {
    setConfirmingRemove(false);
    await poll.remove(friend.userId);
  }

  const name = friend.displayName ?? friend.friendCode ?? t("unknownPlayer");
  const cls = friend.currentCharacter?.class as HeroClass | undefined;

  return (
    <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${friend.online ? "bg-emerald-400" : "bg-ddp-ink-muted/50"}`}
        />
        {cls && <span aria-hidden className="shrink-0 text-sm">{HERO_ICONS[cls] ?? ""}</span>}
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ddp-ink">{name}</span>
        {friend.currentCharacter && (
          <span className="shrink-0 text-[10px] text-ddp-ink-muted tabular-nums">
            {tCommon("levelBadge", { level: friend.currentCharacter.level })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pl-4 text-[11px] text-ddp-ink-muted">
        <span className="min-w-0 flex-1 truncate">
          {friend.currentCharacter ? (
            <>
              {friend.currentCharacter.name}
              {cls && <> · {tContent(`${cls}.name`)}</>}
              {friend.online && friend.lastZone && <> · {zoneLabelFor(friend.lastZone, t, tWorld, tMaps)}</>}
            </>
          ) : (
            t("noCharacter")
          )}
        </span>
        {!friend.online && <span className="shrink-0">{lastSeenLabel(friend.lastSeenAt, t)}</span>}
      </div>

      {actionError && <span className="pl-4 text-[11px] font-semibold text-ddp-bad">{actionError}</span>}
      {inviteNotice && (
        <span className="pl-4 text-[11px] font-semibold text-emerald-300">{inviteNotice}</span>
      )}

      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        {canInvite && (
          <button
            type="button"
            onClick={() => void handleInvite()}
            disabled={inviting}
            className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-gold/50 bg-ddp-gold/10 px-2.5 py-1.5 text-[11px] font-bold text-ddp-gold-bright disabled:opacity-50"
          >
            {inviting ? t("sending") : t("partyInviteButton")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label={t("emojiButton")}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 text-sm text-ddp-ink"
        >
          <span aria-hidden>{"\u{1F44B}"}</span>
        </button>
        {!confirmingRemove ? (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad/40 bg-ddp-bad/10 px-2.5 py-1.5 text-[11px] font-bold text-ddp-bad"
          >
            {t("removeButton")}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ddp-bad">{t("removeConfirmPrompt")}</span>
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad bg-ddp-bad px-2.5 py-1.5 text-[11px] font-bold text-white"
            >
              {t("removeConfirmButton")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-2.5 py-1.5 text-[11px] font-bold text-ddp-ink-muted"
            >
              {t("removeCancelButton")}
            </button>
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="grid grid-cols-6 gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 p-2">
          {FRIEND_EMOJI_ALLOWLIST.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => void handleSendEmoji(e)}
              className="flex min-h-9 items-center justify-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 text-base"
            >
              <span aria-hidden>{e}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Party section (top of the panel when I'm in a party) ────────────────────────

/**
 * M8 "วาปหาเพื่อน" warp button (closes the warp feature, owner spec): shown
 * whenever the member is online AND their `lastZone` parses to a real zone
 * (regardless of scroll count / climb state — those instead decide the
 * DISABLED state + hint, per spec). Fires the `useWarpScroll` intent, then
 * closes the WHOLE Friends panel (fast-travel-picker "close on select"
 * convention — the player wants to SEE the channel start, not the menu).
 */
function WarpToMemberButton({ member, t, onWarp }: { member: PartyMemberWire; t: Translator; onWarp: () => void }) {
  const parsedZone = parseFriendZone(member.lastZone);
  const warpScrollCount = useGameStore((s) => s.shop.counts.warpScroll);
  const unlockedZones = useGameStore((s) => s.unlockedZones);
  const channeling = useGameStore((s) => s.fastTravelChannel !== null);
  const queueWarpScroll = useGameStore((s) => s.queueWarpScroll);
  const pushNotice = useGameStore((s) => s.pushNotice);

  if (!member.online || !parsedZone) return null;

  const hasScroll = warpScrollCount > 0;
  const zoneUnlocked = isZoneUnlockedUi(parsedZone, unlockedZones);
  const disabled = !hasScroll || !zoneUnlocked || channeling;
  const hint = !hasScroll ? t("warpNoScrollHint") : !zoneUnlocked ? t("warpNotClimbedHint") : undefined;

  function handleWarp(): void {
    if (disabled || !parsedZone) return;
    queueWarpScroll({ mapId: parsedZone.mapId, zoneIdx: parsedZone.zoneIdx });
    pushNotice("warpToFriendStarted");
    onWarp();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleWarp}
      title={hint}
      className="min-h-9 shrink-0 rounded-(--ddp-radius-md) border border-sky-400/50 bg-sky-400/10 px-2.5 py-1.5 text-[11px] font-bold text-sky-200 transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
    >
      🌀 {hasScroll ? t("warpToFriendButtonWithCount", { count: warpScrollCount }) : t("warpToFriendButton")}
    </button>
  );
}

function PartyMemberRow({
  member,
  isLeader,
  t,
  tWorld,
  tMaps,
  tContent,
  tCommon,
  onWarp,
}: {
  member: PartyMemberWire;
  isLeader: boolean;
  t: Translator;
  tWorld: Translator;
  tMaps: Translator;
  tContent: Translator;
  tCommon: Translator;
  onWarp: () => void;
}) {
  const name = member.displayName ?? t("unknownPlayer");
  const cls = member.currentCharacter?.class as HeroClass | undefined;
  // M8 party P4b: a one-line same-zone hint — the lockstep cohort itself is driven
  // relay-side (see `ui/party/CohortStatus.tsx`'s HUD chip), this is purely a
  // "you'll see each other" nudge read straight off the ALREADY-throttled world
  // snapshot (no extra request).
  const myWorld = useGameStore((s) => s.world);
  const parsedZone = parseFriendZone(member.lastZone);
  const sameZone =
    member.online &&
    parsedZone !== null &&
    parsedZone.mapId === myWorld.mapId &&
    parsedZone.zoneIdx === myWorld.zoneIdx;
  return (
    <div className="flex flex-col gap-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${member.online ? "bg-emerald-400" : "bg-ddp-ink-muted/50"}`}
        />
        {isLeader && (
          <span aria-label={t("partyLeaderBadge")} className="shrink-0 text-xs text-ddp-gold-bright">
            {LEADER_GLYPH}
          </span>
        )}
        {cls && <span aria-hidden className="shrink-0 text-sm">{HERO_ICONS[cls] ?? ""}</span>}
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ddp-ink">{name}</span>
        {member.currentCharacter && (
          <span className="shrink-0 text-[10px] text-ddp-ink-muted tabular-nums">
            {tCommon("levelBadge", { level: member.currentCharacter.level })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[11px] text-ddp-ink-muted">
          {member.currentCharacter ? (
            <>
              {member.currentCharacter.name}
              {cls && <> · {tContent(`${cls}.name`)}</>}
              {member.online && member.lastZone && (
                <> · {zoneLabelFor(member.lastZone, t, tWorld, tMaps)}</>
              )}
            </>
          ) : (
            t("noCharacter")
          )}
        </span>
        <WarpToMemberButton member={member} t={t} onWarp={onWarp} />
      </div>
      {sameZone && <span className="pl-4 text-[11px] font-semibold text-emerald-300">{t("sameZoneHint")}</span>}
    </div>
  );
}

function PartySection({
  party,
  poll,
  t,
  tWorld,
  tMaps,
  tContent,
  tCommon,
  onWarp,
}: {
  party: PartyWire;
  poll: UseFriendsPoll;
  t: Translator;
  tWorld: Translator;
  tMaps: Translator;
  tContent: Translator;
  tCommon: Translator;
  onWarp: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function handleLeave() {
    setConfirming(false);
    setLeaving(true);
    await poll.leaveParty();
    setLeaving(false);
  }

  return (
    <section className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-ddp-gold-bright uppercase">
          {t("partyGroupTitle", { count: party.members.length, max: MAX_PARTY_SIZE })}
        </h3>
      </div>
      <p className="text-[11px] leading-snug text-ddp-ink-muted">{t("partyPhaseNote")}</p>

      <div className="flex flex-col gap-1.5">
        {party.members.map((m) => (
          <PartyMemberRow
            key={m.userId}
            member={m}
            isLeader={m.userId === party.leaderUserId}
            t={t}
            tWorld={tWorld}
            tMaps={tMaps}
            tContent={tContent}
            tCommon={tCommon}
            onWarp={onWarp}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={leaving}
            className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad/40 bg-ddp-bad/10 px-2.5 py-1.5 text-[11px] font-bold text-ddp-bad disabled:opacity-50"
          >
            {t("partyLeaveButton")}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ddp-bad">{t("partyLeaveConfirmPrompt")}</span>
            <button
              type="button"
              onClick={() => void handleLeave()}
              className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad bg-ddp-bad px-2.5 py-1.5 text-[11px] font-bold text-white"
            >
              {t("partyLeaveConfirmButton")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-2.5 py-1.5 text-[11px] font-bold text-ddp-ink-muted"
            >
              {t("partyLeaveCancelButton")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function PartyInvitesSection({
  invites,
  poll,
  t,
}: {
  invites: IncomingPartyInviteWire[];
  poll: UseFriendsPoll;
  t: Translator;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("partyInvitesGroupTitle")}
      </h3>
      <div className="flex flex-col gap-1.5">
        {invites.map((inv) => (
          <div
            key={inv.inviteId}
            className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-gold/30 bg-ddp-gold/5 px-2.5 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ddp-ink">
              {inv.fromDisplayName ?? t("unknownPlayer")}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => void poll.respondPartyInvite(inv.inviteId, true)}
                className="min-h-9 rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300"
              >
                {t("acceptButton")}
              </button>
              <button
                type="button"
                onClick={() => void poll.respondPartyInvite(inv.inviteId, false)}
                className="min-h-9 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-2.5 py-1.5 text-[11px] font-bold text-ddp-bad"
              >
                {t("declineButton")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
