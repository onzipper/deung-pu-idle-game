"use client";

/**
 * HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — Settings
 * → chosen display title picker. Mounted inside `SettingsPanel.tsx`, same
 * "one-shot mount fetch" idiom as `AccountSection.tsx`. Renders a radio list
 * of every title the active character HOLDS this season (via `titleLabel`,
 * the shared helper — never a raw structural id) plus a "don't show" option,
 * posting the pick to `POST /api/hof/title` (server re-validates against held
 * titles). The whole section is HIDDEN when the character holds none — no
 * empty picker to confuse a player who never placed top-3.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fetchHofRewards, postHofTitle } from "@/ui/hof/rewardsApi";
import { resolveTitlePickerState, type TitlePickerState } from "@/ui/hof/rewardsLogic";
import { titleLabel } from "@/ui/hof/titles";

type FetchState = { kind: "loading" } | TitlePickerState;

export function TitleSection() {
  const t = useTranslations("hof");
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchHofRewards(null, controller.signal).then((res) => {
      setState(resolveTitlePickerState(res.kind === "ok" ? res.data.me : null));
    });
    return () => controller.abort();
  }, []);

  async function pick(titleId: string | null) {
    if (state.kind !== "ready" || saving) return;
    setSaving(true);
    const res = await postHofTitle(titleId);
    setSaving(false);
    if (res && res.ok) {
      setState({ ...state, displayTitle: res.displayTitle });
    }
  }

  if (state.kind === "loading" || state.kind === "hidden") return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("titlePicker.groupTitle")}
      </h3>
      <div className="flex flex-col gap-1.5 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/20 p-2">
        <label className="flex min-h-9 items-center gap-2 rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-semibold text-ddp-ink-muted">
          <input
            type="radio"
            name="hof-display-title"
            checked={state.displayTitle === null}
            disabled={saving}
            onChange={() => void pick(null)}
          />
          {t("titlePicker.noneOption")}
        </label>
        {state.titles.map((mt) => {
          const label = titleLabel(mt.titleId, t);
          if (!label) return null;
          return (
            <label
              key={mt.titleId}
              className="flex min-h-9 items-center gap-2 rounded-(--ddp-radius-md) px-2 py-1.5 text-xs font-bold text-ddp-gold-bright"
            >
              <input
                type="radio"
                name="hof-display-title"
                checked={state.displayTitle === mt.titleId}
                disabled={saving}
                onChange={() => void pick(mt.titleId)}
              />
              {label}
            </label>
          );
        })}
      </div>
    </section>
  );
}
