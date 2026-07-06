/**
 * Small shared CSS-drawn icons (no emoji glyph dependency — Windows 10 footgun
 * #4). `Coin` mirrors the inline markup already duplicated in `HudBar.tsx`/
 * `ShopPanel.tsx`; `MaterialIcon` is new (M7.6 ตีบวก — the refine-material
 * counter, a rough ore/shard chunk distinct in shape+color from the round gold
 * coin so the two currencies never get confused at a glance).
 */

export function Coin({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block shrink-0 rounded-full border-2 border-amber-600 bg-amber-400 shadow-[inset_0_-2px_2px_rgba(0,0,0,0.25)] ${className}`}
    >
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black leading-none text-amber-700">
        ฿
      </span>
    </span>
  );
}

/** A faceted ore/shard chunk — a rotated square with a clipped corner (via a
 * second overlapping rotated square, both flat-fill, no canvas/Pixi gradients)
 * so it reads as a rough mineral chunk rather than a coin or gem. */
export function MaterialIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`}>
      <span
        className="absolute inset-[8%] rotate-45 rounded-[2px] border-2 border-violet-700 bg-violet-400 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.35),inset_-1px_-1px_2px_rgba(0,0,0,0.3)]"
        style={{ clipPath: "polygon(0 0, 100% 20%, 80% 100%, 15% 85%)" }}
      />
    </span>
  );
}
