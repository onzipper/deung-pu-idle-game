/**
 * Pure enter/exit reducer for the Buff Badge Hub's chip row (UX-audit
 * weakness #2 fix: "jitter" — the old strip just added/removed DOM nodes
 * instantly, snapping the row's width and, worse, wrapping onto a second
 * line and shoving the arena below down a few px). No React/DOM here so the
 * transition logic is headlessly testable (`__tests__/animatedChips.test.ts`);
 * `useAnimatedChips.ts` is the only thing that wraps this in timers.
 *
 * Contract: caller feeds `stepAnimatedChips` the previous animated list plus
 * the CURRENT desired keyed items every time the input changes.
 *  - A brand-new key enters as `"entering"` — the caller flips it to `"idle"`
 *    one frame later (`requestAnimationFrame`) so the mount's initial
 *    opacity/scale actually paints before the CSS transition kicks in.
 *  - A key that's still present just gets its `item` payload refreshed
 *    in-place (no phase change — a live badge's numbers ticking, e.g. War
 *    Cry's countdown, must never replay the enter animation).
 *  - A key that disappeared from the desired list moves to `"exiting"` but
 *    STAYS in the returned array (with its last-known `item`) — the caller
 *    removes it for real after the CSS exit transition's duration elapses.
 *  - A key already `"exiting"` is left untouched (never resurrected mid-exit
 *    by a same-tick reappearance — it finishes leaving, then a fresh `"id"
 *    would re-enter from scratch on its next appearance).
 */

export type ChipPhase = "entering" | "idle" | "exiting";

export interface AnimatedChip<T> {
  key: string;
  item: T;
  phase: ChipPhase;
}

export interface KeyedItem<T> {
  key: string;
  item: T;
}

export function stepAnimatedChips<T>(
  prev: readonly AnimatedChip<T>[],
  next: readonly KeyedItem<T>[],
): AnimatedChip<T>[] {
  const nextByKey = new Map(next.map((n) => [n.key, n.item]));
  const result: AnimatedChip<T>[] = [];

  for (const p of prev) {
    if (p.phase === "exiting") {
      // Already leaving — never resurrected by a same-tick reappearance
      // (finishes its exit with its last-known item; a genuinely new
      // occurrence re-enters fresh once the caller drops this one).
      result.push(p);
    } else if (nextByKey.has(p.key)) {
      result.push({ key: p.key, item: nextByKey.get(p.key) as T, phase: p.phase === "entering" ? "entering" : "idle" });
    } else {
      result.push({ ...p, phase: "exiting" });
    }
  }

  const seenKeys = new Set(prev.map((p) => p.key));
  for (const n of next) {
    if (!seenKeys.has(n.key)) {
      result.push({ key: n.key, item: n.item, phase: "entering" });
    }
  }

  return result;
}
