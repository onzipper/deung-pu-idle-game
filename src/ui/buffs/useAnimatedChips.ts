"use client";

/**
 * React glue around the pure `stepAnimatedChips` reducer — the only place
 * timers touch the Buff Badge Hub's enter/exit animation. Keep this file
 * timer-only; the actual diff logic (and its tests) live in
 * `animatedChips.ts`.
 */

import { useEffect, useRef, useState } from "react";
import { stepAnimatedChips, type AnimatedChip, type KeyedItem } from "@/ui/buffs/animatedChips";

/** Must match the CSS `duration-*` class `BuffBadgeHub.tsx` applies to each
 * chip's exit transition — the DOM node is removed right after this elapses. */
export const CHIP_EXIT_MS = 160;

export function useAnimatedChips<T>(next: readonly KeyedItem<T>[]): AnimatedChip<T>[] {
  const [list, setList] = useState<AnimatedChip<T>[]>(() => next.map((n) => ({ ...n, phase: "idle" as const })));

  // `next` is rebuilt fresh every render (new array/object identities) even
  // when its actual content is unchanged; `signature` is the cheap content
  // fingerprint that decides whether a re-step is actually needed. Re-stepping
  // on a genuine change happens SYNCHRONOUSLY during render (React's
  // documented "adjusting state when a prop changes" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect) rather than in a
  // `useEffect`, which would just add a redundant extra render pass for
  // something derivable from props/state alone.
  const signature = next.map((n) => `${n.key}:${JSON.stringify(n.item)}`).join("|");
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setList((prev) => stepAnimatedChips(prev, next));
  }

  // Flip freshly-entered chips to "idle" one frame after mount so the browser
  // paints their initial opacity-0/scale-90 state first — without this the
  // enter transition would never actually play (no property change to
  // transition FROM).
  useEffect(() => {
    if (!list.some((c) => c.phase === "entering")) return;
    const id = requestAnimationFrame(() => {
      setList((prev) => prev.map((c) => (c.phase === "entering" ? { ...c, phase: "idle" } : c)));
    });
    return () => cancelAnimationFrame(id);
  }, [list]);

  // Drop chips once their exit transition has had time to play. One timer per
  // key, tracked in a ref map so it's scheduled EXACTLY once per exit and
  // never reset by a later, unrelated `list` update (e.g. the enter-flip
  // effect above re-rendering while this chip is mid-exit).
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    for (const c of list) {
      if (c.phase !== "exiting" || exitTimers.current.has(c.key)) continue;
      const key = c.key;
      exitTimers.current.set(
        key,
        setTimeout(() => {
          exitTimers.current.delete(key);
          setList((prev) => prev.filter((p) => p.key !== key || p.phase !== "exiting"));
        }, CHIP_EXIT_MS),
      );
    }
  }, [list]);
  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      for (const id of timers.values()) clearTimeout(id);
    };
  }, []);

  return list;
}
