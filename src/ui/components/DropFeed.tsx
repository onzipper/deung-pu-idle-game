"use client";

/**
 * M7 Gear & Drops — drop-feed toast juice. Store-driven off `dropFeed`
 * (pushed only for a freshly-minted claim result — see `gameStore.ts`'s
 * `pushDropFeed` doc), NOT off raw `itemDrop` engine events directly (those
 * are buffered/claimed server-side first; the toast fires once the mint is
 * confirmed, same "one-way, read-only" shape the render fx layer uses for
 * engine events).
 *
 * Wave 3 "จัดระเบียบ DropFeed" (owner goal: "ไม่รก แต่รู้ว่าได้ของ"): epic
 * items keep the ORIGINAL fixed top-center discovery beat (`DropFeed`, kept
 * top-level in `GameHud.tsx`) — commons/rares and stones no longer pile up
 * there. Instead they render inside the arena's bottom-right corner
 * (`DropFeedCorner`, placed inside the arena `div` in `GameHud.tsx`, mirrors
 * `BuffBadgeHub`'s top-left placement) through a max-3-visible, coalescing
 * stack — see `dropFeedCoalesce.ts` for the pure fold logic (unit-tested
 * there; this file is presentation only, no coalescing math lives here).
 *
 * หินเสริมพลัง (enhancement-stone) drops get their OWN raw `stoneFeed`
 * (fires straight off the `stoneDrop` engine event, not a server claim-mint
 * confirmation — a stone has no rarity/identity worth a round-trip wait for)
 * — they ALWAYS land in the coalesced corner stack (never epic-tier).
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/ui/components/icons";
import {
  coalesceDropFeed,
  dismissCoalesced,
  partitionDropFeed,
  EMPTY_COALESCE_STATE,
  type CoalesceState,
  type CoalesceVisible,
} from "@/ui/components/dropFeedCoalesce";
import { RARITY_COLORS } from "@/ui/labels";
import { useGameStore, type DropFeedEntry, type StoneFeedEntry } from "@/ui/store/gameStore";

/** Wall-clock display duration for a corner pill (common item or stone) —
 * short/snappy, matches the owner's "ไม่รก" ask. */
const CORNER_TOAST_DISPLAY_MS = 2200;

/** Wall-clock display duration for the rare top-center epic toast — lingers
 * a beat longer, this IS the discovery moment. */
const EPIC_TOAST_DISPLAY_MS = 5000;

function EpicToast({ entry }: { entry: DropFeedEntry }) {
  const dismiss = useGameStore((s) => s.dismissDropFeed);
  const t = useTranslations("dropFeed");
  const tContent = useTranslations("content.items");
  const colors = RARITY_COLORS[entry.rarity];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(entry.id), EPIC_TOAST_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry`/`dismiss` are stable per mount
  }, []);

  const name = tContent(`${entry.templateId}.name`);

  return (
    <div
      className={`animate-buy-pulse pointer-events-none flex items-center gap-1.5 rounded-(--ddp-radius-md) border ${colors.border} bg-black/80 px-3 py-1.5 text-xs font-bold ${colors.text} shadow-(--ddp-shadow-btn)`}
    >
      {colors.icon && <span aria-hidden>{colors.icon}</span>}
      {t("gotItem", { name })}
    </div>
  );
}

/** Top-center epic/legendary discovery toast — unchanged position/duration
 * from before Wave 3, rendered top-level in `GameHud.tsx` (outside the
 * arena). Renders nothing once no epic entries are live. */
export function DropFeed() {
  const dropFeed = useGameStore((s) => s.dropFeed);
  const { epic } = partitionDropFeed(dropFeed);
  if (epic.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {epic.map((entry) => (
        <EpicToast key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

/** Feeds newly-arrived (never-before-seen) `dropFeed`/`stoneFeed` entries
 * into the pure `coalesceDropFeed` reducer, one at a time, in arrival order.
 * Local-only state — never writes back into the store (the store's own
 * caps already bound `dropFeed`/`stoneFeed`, this hook just folds what's
 * there into the smaller visible-3 stack). */
function useCoalescedCornerFeed(dropFeed: DropFeedEntry[], stoneFeed: StoneFeedEntry[]) {
  const [state, setState] = useState<CoalesceState>(EMPTY_COALESCE_STATE);
  const seenItemIds = useRef(new Set<string>());
  const seenStoneIds = useRef(new Set<string>());

  useEffect(() => {
    const { coalescable } = partitionDropFeed(dropFeed);
    const newItems = coalescable.filter((e) => !seenItemIds.current.has(e.id));
    const newStones = stoneFeed.filter((e) => !seenStoneIds.current.has(e.id));
    if (newItems.length === 0 && newStones.length === 0) return;

    newItems.forEach((e) => seenItemIds.current.add(e.id));
    newStones.forEach((e) => seenStoneIds.current.add(e.id));

    setState((prev) => {
      let next = prev;
      for (const e of newItems) {
        next = coalesceDropFeed(next, {
          kind: "item",
          id: e.id,
          templateId: e.templateId,
          rarity: e.rarity,
        });
      }
      for (const e of newStones) {
        next = coalesceDropFeed(next, { kind: "stone", id: e.id, qty: e.qty });
      }
      return next;
    });
  }, [dropFeed, stoneFeed]);

  const dismiss = (id: string) => setState((prev) => dismissCoalesced(prev, id));

  return { visible: state.visible, overflow: state.overflow, dismiss };
}

function CornerPill({
  entry,
  overflow,
  onDismiss,
}: {
  entry: CoalesceVisible;
  overflow: number;
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations("dropFeed");
  const tContent = useTranslations("content.items");

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(entry.id), CORNER_TOAST_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry.id`/`onDismiss` are stable per mount (a stone merge issues a NEW id, remounting this pill)
  }, []);

  const isStone = entry.kind === "stone";
  const colors = isStone ? null : RARITY_COLORS[entry.rarity];
  const label = isStone
    ? t("gotStones", { qty: entry.qty })
    : t("gotItem", { name: tContent(`${entry.templateId}.name`) });

  return (
    <div
      className={`animate-buy-pulse pointer-events-none flex items-center gap-1 rounded-(--ddp-radius-md) border ${
        isStone ? "border-violet-400/50" : colors!.border
      } bg-black/80 px-2 py-1 text-[11px] font-bold ${
        isStone ? "text-violet-300" : colors!.text
      } shadow-(--ddp-shadow-btn)`}
    >
      {overflow > 0 && <span className="text-ddp-ink/60">{t("overflow", { n: overflow })}</span>}
      {isStone && <MaterialIcon className="h-3 w-3" />}
      {!isStone && colors!.icon && <span aria-hidden>{colors!.icon}</span>}
      <span>{label}</span>
    </div>
  );
}

/** Arena-corner coalesced pill stack for common/rare item drops + stones —
 * MUST be mounted INSIDE the arena `div` (`GameHud.tsx`), mirroring
 * `BuffBadgeHub`'s `absolute top-[14%] left-2 z-10` on the opposite corner.
 * Renders nothing once the stack is empty. */
export function DropFeedCorner() {
  const dropFeed = useGameStore((s) => s.dropFeed);
  const stoneFeed = useGameStore((s) => s.stoneFeed);
  const { visible, overflow, dismiss } = useCoalescedCornerFeed(dropFeed, stoneFeed);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex flex-col items-end gap-1">
      {visible.map((entry, i) => (
        <CornerPill
          key={entry.id}
          entry={entry}
          overflow={i === 0 ? overflow : 0}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
