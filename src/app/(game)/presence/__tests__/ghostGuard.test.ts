import { describe, it, expect, beforeEach } from "vitest";
import { CONFIG, initGameState, makeHero } from "@/engine";
import type { FrameInput, GameState, HeroClass, HeroStats } from "@/engine";
import { INPUT_DELAY_TURNS, LockstepClient } from "@/engine/lockstep";
import { soloSave } from "@/engine/__tests__/helpers";
import { GHOST_ACTIONS, GhostStore } from "../ghostStore";
import { useGameStore } from "@/ui/store/gameStore";

/**
 * THE ONE RULE guard (docs/ghost-presence-design.md §2, invariants #1–#3): a `GhostStore`
 * fed garbage presence the whole time MUST NOT perturb the lockstep sim by a single bit.
 * Structurally it can't (the store never touches `GameState`); this test PINS that against
 * future refactors — the same trajectory with and without the ghost feed, byte-for-byte.
 *
 * Issue #50 Wave 6 extends this to the R3 action stream + tap-profile surfaces added in
 * Waves 1–5: `ghostStore.ingestAction` (the `pa` action feed, including stale/replayed
 * counters, actions for never-upserted ghosts, and payloads `parseGhostAction` rejects
 * outright) and the `gameStore` tap-profile actions (`openGhostProfile`/`closeGhostProfile`,
 * the OTHER half of "a ghost tap can never become an intent" alongside
 * `ui/store/__tests__/ghostProfileActions.test.ts`'s direct unit coverage). Both write to
 * state that lives entirely outside `GameState`/`FrameInput`, so the hash trajectory AND
 * `pendingInput` must come out byte-identical to a presence-free run.
 */

/** cids matching the `p` snapshots this test already upserts each turn (`g0`..`g3`) — the
 *  `pa` stream targets the SAME identities so "known ghost, action stream" is exercised,
 *  not just "unknown ghost, always dropped". */
const PA_CIDS = ["g0", "g1", "g2", "g3"];

/** A realistic-but-adversarial `pa` payload for turn `t`: valid forward-advancing action
 *  frames, a stale/replayed counter, an action for a ghost that was never `p`-upserted
 *  (no keepalive presence — must be dropped, not spawn a ghost), and shapes
 *  `parseGhostAction` rejects outright (wrong protocol version, missing cid, unknown
 *  action name, not an object at all — all must parse to `null` and be swallowed). */
function paFrame(t: number): unknown {
  const cid = PA_CIDS[t % PA_CIDS.length];
  switch (t % 7) {
    case 0: // valid, forward-advancing counter
      return { v: 1, cid, x: Math.cos(t) * 500, y: Math.sin(t) * 40, f: t % 2 === 0 ? 1 : -1, a: GHOST_ACTIONS[t % GHOST_ACTIONS.length], at: t };
    case 1: // stale/replayed counter (same `at` as a previously-accepted frame)
      return { v: 1, cid, x: 0, f: 1, a: "idle", at: 1 };
    case 2: // unknown ghost — never seen via a `p` keepalive
      return { v: 1, cid: "phantom-" + t, x: 999, f: 1, a: "walk", at: t };
    case 3: // malformed: wrong protocol version → parseGhostAction returns null
      return { v: 2, cid, x: 0, a: "idle", at: t };
    case 4: // malformed: missing cid
      return { v: 1, x: 0, a: "idle", at: t };
    case 5: // malformed: unknown action name
      return { v: 1, cid, x: 0, a: "teleport", at: t };
    default: // malformed: not an object at all
      return "not-an-object";
  }
}

function prog(cls: HeroClass): { cls: HeroClass; level: number; statPoints: number; stats: HeroStats } {
  return { cls, level: 3, statPoints: 0, stats: { ...CONFIG.stats.base[cls] } };
}

function buildCohort(seed: number): GameState {
  const progs = [prog("swordsman"), prog("archer")];
  const s = initGameState(seed, soloSave(progs[0].cls, 3));
  s.heroes = progs.map((p, i) => makeHero(i + 1, p.cls, p.level, 0, 1, p.statPoints, { ...p.stats }));
  s.nextId = progs.length + 1;
  return s;
}

const script = (slot: number, turn: number): FrameInput | null => {
  if (turn < 3 || turn % 20 !== slot % 20) return null;
  return slot % 2 === 0
    ? { moveTo: { x: 260 + (turn % 200) } }
    : { setHeroConfig: { autoHunt: (turn >> 3) % 2 === 0, autoCast: true } };
};

/** Run a 2-client no-jitter lockstep for `turns`, optionally threading a GhostStore that
 *  ingests garbage every turn. Returns client 0's per-turn hash trajectory. `onTap`, when
 *  given, is invoked every time a store tap-profile action fires (so a caller can assert
 *  the tap stream actually ran without depending on ITS final open/close parity). */
function run(turns: number, withGhosts: boolean, onTap?: () => void): number[] {
  const clients = [new LockstepClient(buildCohort(4242), 2), new LockstepClient(buildCohort(4242), 2)];
  const ghosts = withGhosts ? new GhostStore() : null;
  const traj: number[] = [];
  for (let t = 0; t < turns; t++) {
    for (let slot = 0; slot < 2; slot++) {
      const input = script(slot, t);
      if (!input) continue;
      const msg = clients[slot].issue(slot, t, input); // self-schedules on the issuer
      for (let c = 0; c < 2; c++) {
        if (c !== slot) {
          const ok = clients[c].deliver(msg);
          expect(ok).toBe(true); // 2-turn delay = always in time
        }
      }
    }
    if (ghosts) {
      // Garbage of every shape, plus a plausible-but-junk snapshot, ingested + queried the
      // whole run — none of it may reach the sim.
      ghosts.upsert({ v: 1, cid: "g" + (t % 4), name: "junk", cls: "wizard", tier: 9, x: Math.sin(t) * 9e9, t }, t);
      ghosts.upsert("not an object", t);
      ghosts.upsert({ garbage: true }, t);
      ghosts.upsert(null, t);
      ghosts.setExcluded(new Set(["g0"]));
      // R3 `pa` action stream: mixed valid/stale/unknown-ghost/malformed frames, every turn.
      ghosts.ingestAction(paFrame(t), t);
      ghosts.prune(t);
      // The render path reads the list every frame — must never mutate anything it touches.
      ghosts.list(t);
      // Ghost-tap "profile card" — the store-level half of "tap fully consumed, no intent"
      // (mirrors GameClient.tsx's onArenaClick: hitTestGhost -> openGhostProfile -> return).
      if (t % 11 === 0) {
        useGameStore.getState().openGhostProfile(PA_CIDS[Math.floor(t / 11) % PA_CIDS.length]);
        onTap?.();
      }
      if (t % 17 === 0) {
        useGameStore.getState().closeGhostProfile();
        onTap?.();
      }
    }
    const h0 = clients[0].advance();
    const h1 = clients[1].advance();
    expect(h1).toBe(h0);
    traj.push(h0);
  }
  return traj;
}

describe("ghost presence — hash-equality guard (The One Rule)", () => {
  beforeEach(() => {
    // The gameStore is a module-level singleton shared across the whole test file — start
    // every test from a known-empty queue/cid so a prior test's tap state can't leak in.
    useGameStore.getState().drainPendingInput();
    useGameStore.setState({ ghostProfileCid: null });
  });

  it("2 clients over 800 turns hash identically WITH and WITHOUT a garbage ghost feed", () => {
    expect(INPUT_DELAY_TURNS).toBe(2); // the slack the immediate-deliver relay relies on
    const withGhosts = run(800, true);
    const control = run(800, false);
    expect(withGhosts).toEqual(control);
    // sanity: the sim actually advanced (not a frozen constant hashing the same value)
    expect(new Set(control).size).toBeGreaterThan(20);
  });

  it("800-turn run with a live pa/tap-profile feed never writes pendingInput, and still hashes identically to no-presence at all", () => {
    const pendingBefore = useGameStore.getState().pendingInput;
    let taps = 0;
    const withPresence = run(800, true, () => taps++); // pa stream + open/closeGhostProfile taps
    const s = useGameStore.getState();
    // Reference-equal: NOTHING in the 800-turn run ever called `set({ pendingInput: ... })`.
    // (openGhostProfile/closeGhostProfile only ever touch `ghostProfileCid` — see
    // `ui/store/__tests__/ghostProfileActions.test.ts` for the same guarantee, unit-scale.)
    expect(s.pendingInput).toBe(pendingBefore);
    expect(s.pendingInput.moveTo).toBeNull();
    expect(s.pendingInput.castSkills).toEqual([]);
    // The tap stream DID run repeatedly, so this isn't a vacuous pass.
    expect(taps).toBeGreaterThan(50);

    const baseline = run(800, false); // no presence traffic of any kind
    expect(withPresence).toEqual(baseline);
  });
});
