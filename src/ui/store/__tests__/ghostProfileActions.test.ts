/**
 * R3 "tap profile" (issue #50 Wave 5) — store-level wiring test for
 * `openGhostProfile`/`closeGhostProfile`. THE load-bearing guarantee this
 * pins: opening (or closing) a ghost's read-only profile card NEVER produces
 * a command intent — `pendingInput` is byte-identical before and after,
 * across every field the queue exposes (not just `moveTo`). This is the
 * store-level half of the "tap fully consumed, no `moveTo`" contract;
 * `GameClient.tsx`'s pointer handler (see its `onArenaClick` doc) is the
 * other half — it calls `openGhostProfile` and `return`s, never reaching the
 * `queueMoveTo` fallback below it.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useGameStore } from "@/ui/store/gameStore";

describe("ghost profile store wiring", () => {
  beforeEach(() => {
    useGameStore.getState().drainPendingInput();
    useGameStore.setState({ ghostProfileCid: null });
  });

  it("openGhostProfile sets the cid and leaves pendingInput completely untouched", () => {
    const before = useGameStore.getState().pendingInput;
    useGameStore.getState().openGhostProfile("peer-42");
    const s = useGameStore.getState();
    expect(s.ghostProfileCid).toBe("peer-42");
    expect(s.pendingInput).toBe(before); // same reference: no intent write at all
    expect(s.pendingInput.moveTo).toBeNull();
  });

  it("closeGhostProfile clears the cid and also never touches pendingInput", () => {
    useGameStore.getState().openGhostProfile("peer-42");
    const before = useGameStore.getState().pendingInput;
    useGameStore.getState().closeGhostProfile();
    const s = useGameStore.getState();
    expect(s.ghostProfileCid).toBeNull();
    expect(s.pendingInput).toBe(before);
  });

  it("last-wins: opening a second ghost's profile just swaps the cid, still no intent", () => {
    useGameStore.getState().openGhostProfile("peer-1");
    const before = useGameStore.getState().pendingInput;
    useGameStore.getState().openGhostProfile("peer-2");
    const s = useGameStore.getState();
    expect(s.ghostProfileCid).toBe("peer-2");
    expect(s.pendingInput).toBe(before);
  });
});
