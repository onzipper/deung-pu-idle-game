import { describe, it, expect } from "vitest";
import { CONFIG, initGameState, makeHero } from "@/engine";
import type { FrameInput, GameState, HeroClass, HeroStats } from "@/engine";
import { INPUT_DELAY_TURNS, LockstepClient } from "@/engine/lockstep";
import { soloSave } from "@/engine/__tests__/helpers";
import { GhostStore } from "../ghostStore";

/**
 * THE ONE RULE guard (docs/ghost-presence-design.md §2, invariants #1–#3): a `GhostStore`
 * fed garbage presence the whole time MUST NOT perturb the lockstep sim by a single bit.
 * Structurally it can't (the store never touches `GameState`); this test PINS that against
 * future refactors — the same trajectory with and without the ghost feed, byte-for-byte.
 */

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
 *  ingests garbage every turn. Returns client 0's per-turn hash trajectory. */
function run(turns: number, withGhosts: boolean): number[] {
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
      ghosts.prune(t);
      ghosts.list(t);
    }
    const h0 = clients[0].advance();
    const h1 = clients[1].advance();
    expect(h1).toBe(h0);
    traj.push(h0);
  }
  return traj;
}

describe("ghost presence — hash-equality guard (The One Rule)", () => {
  it("2 clients over 800 turns hash identically WITH and WITHOUT a garbage ghost feed", () => {
    expect(INPUT_DELAY_TURNS).toBe(2); // the slack the immediate-deliver relay relies on
    const withGhosts = run(800, true);
    const control = run(800, false);
    expect(withGhosts).toEqual(control);
    // sanity: the sim actually advanced (not a frozen constant hashing the same value)
    expect(new Set(control).size).toBeGreaterThan(20);
  });
});
