"use client";

/**
 * R2.5-W3 MiniMapCard — compact "where am I" card for the top-right HUD
 * column (owner ref: a small framed map box). This is NOT the R4/R5 corner
 * minimap proper (docs/ui-reference-map.md: that waits on the world becoming
 * true x,y geometry) — it's a compact SUMMARY that taps through to the
 * existing R1 `WorldMapPanel` (same "one mental model per feature" rule:
 * there is still exactly one travel surface, this is just a live-glanceable
 * entry point to it, same idiom as `WorldMapButton.tsx`).
 *
 * Shows: current zone name (map name + โซน N, same `world.zoneTown`/
 * `world.zoneFarm` copy the dissolved `HudBar.tsx` chip used), a live 👥
 * population badge for the CURRENT zone (`useZoneCounts`, 30s cadence —
 * slower than the panel's own 10s poll since this card is ALWAYS mounted),
 * and — on `sm:` and up — a compact code-drawn SVG strip: the hero's live x
 * position, gate markers at both zone edges (open/locked, the SAME
 * `world.left`/`world.right` data `gateTap.ts` already reads — no new engine
 * read), and town NPC dots (town zones only, `CONFIG.townNpcs`). The strip is
 * hidden below `sm:` so mobile collapses to just the zone label + population
 * chip (task brief's "compact on mobile" clause) — a CSS-only collapse, no
 * `useMediaQuery` needed.
 *
 * Read-only navigation surface: tapping anywhere on the card opens
 * `WorldMapPanel` — it does NOT tap-through to individual NPCs or gates
 * directly, consistent with the LOCKED owner ruling that shop/refine/quest
 * stay NPC-walk-up-only (docs/ui-reference-map.md; see also `GameHud.tsx`'s
 * dissolved-components note for the HUD icon row's own scope decision).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CONFIG } from "@/engine";
import { useGameStore } from "@/ui/store/gameStore";
import { useZoneCounts } from "@/ui/world/useZoneCounts";
import { WorldMapPanel } from "@/ui/world/WorldMapPanel";
import { zoneKeyOf } from "@/ui/world/worldMapModel";

/** Every map's `fieldWidth` (engine units) is 900 today (`CONFIG.world.maps`)
 * — the same convention the 900×300 arena render used pre-fullscreen-HUD.
 * Kept as a local fallback constant (not read off `CONFIG.world.maps` per
 * frame) since this is a cosmetic strip, not a hit-test. */
const FIELD_WIDTH = 900;
const STRIP_W = 120;
const STRIP_H = 14;
/** Slower than `WorldMapPanel`'s own 10s poll (R2.5-W3 doc) — this card is
 * ALWAYS mounted, so it shouldn't hammer the relay just for a glance chip. */
const MINIMAP_POLL_MS = 30_000;

function clampFrac(x: number): number {
  return Math.max(0, Math.min(1, x / FIELD_WIDTH));
}

export function MiniMapCard() {
  const t = useTranslations("world");
  const tMap = useTranslations("worldMap");
  const tMaps = useTranslations("content.maps");
  const [open, setOpen] = useState(false);

  const world = useGameStore((s) => s.world);
  const heroX = useGameStore((s) => s.heroes[0]?.x ?? FIELD_WIDTH / 2);

  const counts = useZoneCounts({ open: true, pollMs: MINIMAP_POLL_MS });
  const myCount = counts ? (counts[zoneKeyOf(world)] ?? 0) : null;

  const zoneLabel =
    world.kind === "town" ? t("zoneTown") : t("zoneFarm", { stage: world.stage });
  const mapName = tMaps(`${world.mapId}.name`);
  const heroFrac = clampFrac(heroX);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tMap("entryAria")}
        title={tMap("entryAria")}
        className="pointer-events-auto flex min-h-11 w-full max-w-[172px] flex-col gap-1 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-2.5 py-1.5 text-left shadow-(--ddp-shadow-panel) transition-transform duration-100 active:scale-95"
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[11px] font-bold text-ddp-ink">
            {mapName} · {zoneLabel}
          </span>
          {myCount !== null && (
            <span
              title={tMap("populationTooltip")}
              className="shrink-0 rounded-full border border-ddp-border-soft bg-black/30 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-ddp-ink-muted"
            >
              👥{myCount}
            </span>
          )}
        </div>
        {/* Compact SVG strip — desktop/wide only (task brief's "compact on
            mobile" clause), CSS-only collapse. */}
        <svg viewBox={`0 0 ${STRIP_W} ${STRIP_H}`} className="hidden h-3.5 w-full sm:block" aria-hidden>
          <rect
            x={0}
            y={STRIP_H / 2 - 1.5}
            width={STRIP_W}
            height={3}
            rx={1.5}
            className="fill-white/10"
          />
          {world.left && (
            <circle
              cx={2.5}
              cy={STRIP_H / 2}
              r={2.5}
              className={world.left.unlocked ? "fill-emerald-400" : "fill-rose-500"}
            />
          )}
          {world.right && (
            <circle
              cx={STRIP_W - 2.5}
              cy={STRIP_H / 2}
              r={2.5}
              className={world.right.unlocked ? "fill-emerald-400" : "fill-rose-500"}
            />
          )}
          {world.kind === "town" &&
            CONFIG.townNpcs.map((npc) => (
              <circle
                key={npc.id}
                cx={clampFrac(npc.x) * STRIP_W}
                cy={STRIP_H / 2}
                r={1.8}
                className="fill-amber-300"
              />
            ))}
          <circle
            cx={heroFrac * STRIP_W}
            cy={STRIP_H / 2}
            r={3}
            className="fill-ddp-gold-bright stroke-black/50"
            strokeWidth={0.6}
          />
        </svg>
      </button>
      {open && <WorldMapPanel onClose={() => setOpen(false)} />}
    </>
  );
}
