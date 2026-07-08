"use client";

/**
 * Settings → My Account (M8 Phase 0). Mounted inside `SettingsPanel.tsx`.
 *
 * Guest state: a short pitch + inline `RegisterForm` (binds the account onto
 * the SAME identity-cookie user row, so saves/characters survive) plus a
 * soft-warned link to `/welcome`'s login lane for switching to an existing
 * account. Registered state: email/displayName/friendCode (tap-to-copy) +
 * a confirm-gated logout. No modal/overlay is used here (the confirm step
 * is an inline expand, not a portal) — this whole section already lives
 * inside `SettingsPanel`'s `ModalPortal`.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RegisterForm } from "@/ui/components/welcome/RegisterForm";

interface AccountInfo {
  registered: boolean;
  email: string | null;
  displayName: string | null;
  friendCode: string | null;
}

type Status = "loading" | "error" | "ready";

export function AccountSection() {
  const t = useTranslations("auth.account");

  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [copied, setCopied] = useState(false);
  // displayName rename (once/day) — inline edit + feedback (house style: no toast).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [renameMsg, setRenameMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as AccountInfo;
      setInfo(data);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    // One-shot mount fetch — same pattern as `CharactersScreen.fetchCharacters`.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount fetch, see above
    void refresh();
  }, []);

  function retry() {
    setStatus("loading");
    void refresh();
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/welcome";
        return;
      }
    } catch {
      // fall through to re-enable the button below
    }
    setLoggingOut(false);
  }

  function startEditName() {
    setNameDraft(info?.displayName ?? "");
    setRenameMsg(null);
    setEditingName(true);
  }

  async function submitRename() {
    const displayName = nameDraft.trim();
    if (!displayName || savingName) return;
    setSavingName(true);
    setRenameMsg(null);
    try {
      const res = await fetch("/api/account/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (res.ok) {
        setEditingName(false);
        setRenameMsg({ kind: "ok", text: t("renameSuccess") });
        await refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { code?: string } | null;
        setRenameMsg({
          kind: "err",
          text: data?.code === "rename_cooldown" ? t("renameCooldown") : t("renameError"),
        });
      }
    } catch {
      setRenameMsg({ kind: "err", text: t("renameError") });
    }
    setSavingName(false);
  }

  function handleCopyFriendCode() {
    if (!info?.friendCode) return;
    navigator.clipboard
      ?.writeText(info.friendCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // clipboard denied/unavailable — non-critical, silently ignore
      });
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("groupTitle")}
      </h3>

      {status === "loading" && (
        <div className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 px-3 py-4 text-center text-[12px] text-ddp-ink-muted">
          {t("loading")}
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-4 text-center">
          <span className="text-[12px] font-semibold text-ddp-bad">{t("loadError")}</span>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 py-2 text-xs font-bold text-ddp-ink"
          >
            {t("retryButton")}
          </button>
        </div>
      )}

      {status === "ready" && info?.registered && (
        <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-ddp-ink-muted">{t("emailLabel")}</span>
            <span className="font-semibold text-ddp-ink">{info.email}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-ddp-ink-muted">{t("displayNameLabel")}</span>
              {!editingName && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ddp-ink">
                    {info.displayName ?? t("noDisplayName")}
                  </span>
                  <button
                    type="button"
                    onClick={startEditName}
                    aria-label={t("renameEditAria")}
                    className="rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-2 py-0.5 text-[12px] leading-none hover:border-emerald-400/60"
                  >
                    ✏️
                  </button>
                </div>
              )}
            </div>
            {editingName && (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    maxLength={24}
                    autoFocus
                    placeholder={t("renamePlaceholder")}
                    className="min-h-11 min-w-0 flex-1 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-3 py-2 text-sm font-medium text-ddp-ink outline-none focus:border-emerald-400/60"
                  />
                  <button
                    type="button"
                    disabled={savingName || nameDraft.trim().length === 0}
                    onClick={() => void submitRename()}
                    className="min-h-11 rounded-(--ddp-radius-md) border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingName ? t("renameSaving") : t("renameSave")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-3 py-2 text-xs font-bold text-ddp-ink-muted hover:text-ddp-ink"
                  >
                    {t("renameCancel")}
                  </button>
                </div>
                <span className="text-[10.5px] leading-snug text-ddp-ink-muted">
                  {t("renameHint")}
                </span>
              </div>
            )}
            {renameMsg && (
              <span
                className={`text-[11px] font-semibold ${renameMsg.kind === "ok" ? "text-emerald-300" : "text-ddp-bad"}`}
              >
                {renameMsg.text}
              </span>
            )}
          </div>
          {info.friendCode && (
            <button
              type="button"
              onClick={handleCopyFriendCode}
              className="flex items-center justify-between gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/30 px-3 py-2 text-[12px] transition-colors hover:border-emerald-400/60"
            >
              <span className="text-ddp-ink-muted">{t("friendCodeLabel")}</span>
              <span className="font-mono font-bold tracking-wider text-ddp-gold-bright">
                {info.friendCode}
              </span>
              <span className="text-[10px] font-bold text-emerald-300">
                {copied ? t("copied") : t("copyButton")}
              </span>
            </button>
          )}

          {!confirmingLogout ? (
            <button
              type="button"
              onClick={() => setConfirmingLogout(true)}
              className="min-h-11 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 px-3 py-2 text-xs font-bold text-ddp-bad"
            >
              {t("logoutButton")}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-(--ddp-radius-md) border border-ddp-bad/50 bg-ddp-bad/10 p-3">
              <span className="text-[11.5px] leading-snug text-ddp-bad">{t("logoutWarning")}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingLogout(false)}
                  className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-border bg-black/30 px-3 py-2 text-xs font-bold text-ddp-ink-muted hover:text-ddp-ink"
                >
                  {t("logoutCancel")}
                </button>
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                  className="min-h-11 flex-1 rounded-(--ddp-radius-md) border border-ddp-bad bg-ddp-bad px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loggingOut ? t("loggingOut") : t("logoutConfirm")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status === "ready" && info && !info.registered && (
        <div className="flex flex-col gap-3 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-3">
          <p className="text-[12px] leading-snug text-ddp-ink-muted">{t("guestPitch")}</p>
          <RegisterForm onSuccess={() => void refresh()} />
          <div className="flex flex-col gap-1 border-t border-ddp-border-soft pt-2">
            <span className="text-[11px] leading-snug text-ddp-ink-muted">
              {t("switchAccountHint")}
            </span>
            <a
              href="/welcome"
              className="text-[12px] font-bold text-emerald-300 underline underline-offset-2"
            >
              {t("switchAccountLink")}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
