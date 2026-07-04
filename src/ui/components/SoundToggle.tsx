"use client";

/**
 * Speaker mute/unmute toggle. `soundMuted` is a plain UI-owned store field
 * (like `speed`/`autoUpgrade`/`autoCast`) that `GameClient`'s integration
 * loop reads every frame and applies to the `AudioController` — this button
 * never touches audio directly, it only flips the store flag.
 *
 * Default is SOUND ON; the very first sound still can't play until a real
 * user gesture resumes the `AudioContext` (browser autoplay policy — see
 * `GameClient.tsx`'s pointerdown wiring), so an obvious toggle here is the
 * only affordance a player needs before then.
 */

import { useEffect } from "react";
import { readStoredSoundMuted, useGameStore } from "@/ui/store/gameStore";

export function SoundToggle() {
  const soundMuted = useGameStore((s) => s.soundMuted);
  const toggleSound = useGameStore((s) => s.toggleSound);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);

  // Apply the persisted preference once, AFTER hydration (reading
  // localStorage during the initial render would make the server-rendered
  // HTML and the first client render disagree — see gameStore.ts).
  useEffect(() => {
    setSoundMuted(readStoredSoundMuted());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync
  }, []);

  return (
    <button
      type="button"
      onClick={toggleSound}
      aria-pressed={!soundMuted}
      aria-label={soundMuted ? "เปิดเสียง" : "ปิดเสียง"}
      title={soundMuted ? "เปิดเสียง" : "ปิดเสียง"}
      className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
        soundMuted
          ? "border-zinc-700 bg-zinc-800 text-zinc-500"
          : "border-emerald-400 bg-emerald-400 text-emerald-950"
      }`}
    >
      {soundMuted ? "🔇" : "🔊"}
    </button>
  );
}
