"use client";

/**
 * M8 party P4b — the lockstep cohort HUD chip. Presentational only: ALL the
 * connect/handshake/turn-buffering logic lives in `app/(game)/partySession.ts` +
 * `app/(game)/partyHandshake.ts` (owned by `GameClient.tsx`), which push the
 * display-ready `cohortStatus` field into the store (`gameStore.ts`'s
 * `CohortStatusState`) on transitions only — never per-frame. Renders NOTHING for
 * `"solo"` (not in a party, or alone in my zone — no cohort, zero HUD footprint for
 * the overwhelming common case). Desktop + mobile: a slim inline strip, same tier as
 * the fast-travel channel chip, sits in the HUD flow (not a fixed overlay).
 */

import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";

export function CohortStatus() {
  const t = useTranslations("partyCohort");
  const status = useGameStore((s) => s.cohortStatus);

  if (status.kind === "solo") return null;

  const label =
    status.kind === "connecting"
      ? t("connecting")
      : status.kind === "waiting"
        ? t("waiting")
        : status.kind === "reconnecting"
          ? t("reconnecting")
          : t("playingWith", { names: status.names.join(", ") });

  const tone =
    status.kind === "active"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : status.kind === "waiting"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted";

  return (
    <div
      role="status"
      className={`w-full rounded-(--ddp-radius-md) border px-3 py-1.5 text-center text-[11px] font-semibold ${tone}`}
    >
      {label}
    </div>
  );
}
