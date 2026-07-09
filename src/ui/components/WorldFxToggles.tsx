"use client";

/**
 * "โลกมีมิติ" (world-depth) settings row — promoted lab experiment ⑨ (depth
 * band + terrain + living camera + day/night atmosphere), W6 of the
 * `lab-proud-tiger` plan. Three independent switches (one mental model per
 * concept — see the game-ux skill's "one place, one master switch" rule, and
 * `GhostToggle.tsx`, this component's template): `worldDepthOn` drives BOTH
 * the depth band and the terrain ground layer (they read as a single visual
 * idea to a player), `worldCameraOn` the living follow-zoom camera,
 * `worldAtmosphereOn` day/night + weather + critters. All three are plain
 * UI-owned store fields (localStorage-persisted, NOT SaveData — same tier as
 * `ghostsVisible`/`soundMuted`); `GameClient.tsx`'s loop reads them to drive
 * `renderer.setWorldFx(...)`. Purely cosmetic/render — never touches the sim.
 * Default ON.
 */

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  readStoredWorldDepthOn,
  readStoredWorldCameraOn,
  readStoredWorldAtmosphereOn,
  useGameStore,
} from "@/ui/store/gameStore";

/** One switch row — same visual idiom as `GhostToggle`'s button (colors,
 *  min-h-11 touch target, active-press feedback), just parameterized so the
 *  three rows below don't triplicate the markup. */
function WorldFxRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-ddp-ink">{label}</span>
      <button
        type="button"
        role="switch"
        onClick={onToggle}
        aria-checked={on}
        aria-label={label}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-(--ddp-radius-md) border px-3 text-lg shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] ${
          on
            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
            : "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted"
        }`}
      >
        {on ? "🌍" : "⬛"}
      </button>
    </label>
  );
}

export function WorldFxToggles() {
  const worldDepthOn = useGameStore((s) => s.worldDepthOn);
  const worldCameraOn = useGameStore((s) => s.worldCameraOn);
  const worldAtmosphereOn = useGameStore((s) => s.worldAtmosphereOn);
  const toggleWorldDepthOn = useGameStore((s) => s.toggleWorldDepthOn);
  const toggleWorldCameraOn = useGameStore((s) => s.toggleWorldCameraOn);
  const toggleWorldAtmosphereOn = useGameStore((s) => s.toggleWorldAtmosphereOn);
  const setWorldDepthOn = useGameStore((s) => s.setWorldDepthOn);
  const setWorldCameraOn = useGameStore((s) => s.setWorldCameraOn);
  const setWorldAtmosphereOn = useGameStore((s) => s.setWorldAtmosphereOn);
  const t = useTranslations("settings.worldFx");

  // Apply the persisted preferences once, AFTER hydration (reading localStorage
  // during the initial render would desync SSR/first-client render — see
  // gameStore.ts / GhostToggle's identical mount-effect pattern).
  useEffect(() => {
    setWorldDepthOn(readStoredWorldDepthOn());
    setWorldCameraOn(readStoredWorldCameraOn());
    setWorldAtmosphereOn(readStoredWorldAtmosphereOn());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("header")}
      </h3>
      <p className="text-xs text-ddp-ink-muted">{t("desc")}</p>
      <WorldFxRow label={t("depthLabel")} on={worldDepthOn} onToggle={toggleWorldDepthOn} />
      <WorldFxRow label={t("cameraLabel")} on={worldCameraOn} onToggle={toggleWorldCameraOn} />
      <WorldFxRow
        label={t("atmosphereLabel")}
        on={worldAtmosphereOn}
        onToggle={toggleWorldAtmosphereOn}
      />
    </section>
  );
}
