import { describe, it, expect } from "vitest";
import {
  CONFIG,
  initGameState,
  step,
  toSaveData,
  dropTableForStage,
  lootFloat,
  stoneFloat,
  STONE_DOMAIN,
  type GameState,
} from "@/engine";
import { soloSave, makeStubEnemy } from "./helpers";

/**
 * "หินเสริมพลัง" ENHANCEMENT-STONE drops (M7.6 follow-up). Determinism of the
 * domain-tagged stone stream, the HARD requirement that gear-drop sequences stay
 * byte-identical with stones enabled (stream isolation), and the claim-key contract
 * (a stone's rollId == the kill's gear rollId — monotonic + unique — so the server
 * credits idempotently off `${characterId}:stone:${rollId}`).
 */

interface DropLog {
  gear: { rollId: string; templateId: string }[];
  stones: { rollId: string; qty: number; mobId: number }[];
}

/** Collect gear + stone events across `n` steps. */
function collect(s: GameState, n: number): DropLog {
  const gear: DropLog["gear"] = [];
  const stones: DropLog["stones"] = [];
  for (let i = 0; i < n; i++) {
    step(s, {});
    for (const e of s.events) {
      if (e.type === "itemDrop") gear.push({ rollId: e.rollId, templateId: e.templateId });
      if (e.type === "stoneDrop") stones.push({ rollId: e.rollId, qty: e.qty, mobId: e.mobId });
    }
  }
  return { gear, stones };
}

describe("stone stream primitive (core/hash.stoneFloat)", () => {
  it("is pure, in [0,1), and INDEPENDENT of the gear stream at the same (salt,counter)", () => {
    // Reproducible + bounded.
    expect(stoneFloat(123, 7)).toBe(stoneFloat(123, 7));
    for (let c = 0; c < 500; c++) {
      const f = stoneFloat(999, c);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    // Sensitive to both inputs.
    expect(stoneFloat(123, 7)).not.toBe(stoneFloat(124, 7));
    expect(stoneFloat(123, 7)).not.toBe(stoneFloat(123, 8));
    // Decorrelated from the gear stream: for the SAME (salt,counter) the two streams
    // disagree on essentially every draw (the domain XOR + splitmix32 avalanche).
    let agree = 0;
    for (let c = 0; c < 2000; c++) {
      if (stoneFloat(4242, c) === lootFloat(4242, c)) agree++;
    }
    expect(agree).toBe(0);
    expect(STONE_DOMAIN).not.toBe(0);
  });
});

describe("stone-drop determinism", () => {
  it("same (save, seed) → identical stone stream (rollId + qty + mobId)", () => {
    const save = soloSave("swordsman", 3);
    const a = collect(initGameState(4242, save), 4000);
    const b = collect(initGameState(4242, save), 4000);
    expect(a.stones.length).toBeGreaterThan(0); // stones actually dropped
    expect(a.stones).toEqual(b.stones);
  });

  it("stone qty is a whole number ≥1 and scales with map depth", () => {
    // Force one-shot stub kills so a level-1 hero can farm even the deepest stage
    // (deep mobs are otherwise unkillable at low level). state.stage drives map tier.
    const forceStoneQtys = (stage: number): number[] => {
      const s = initGameState(7, soloSave("mage", stage));
      s.spawnPaused = true;
      const qtys: number[] = [];
      for (let k = 0; k < 400; k++) {
        s.enemies = [makeStubEnemy(3000 + k, s.heroes[0].x + 5, 1)];
        s.heroes[0].cd = 0;
        step(s, {});
        for (const e of s.events) if (e.type === "stoneDrop") qtys.push(e.qty);
      }
      return qtys;
    };
    const shallow = forceStoneQtys(2); // map1 (tier 1)
    const deep = forceStoneQtys(28); // map6 (tier 6)
    expect(shallow.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    for (const q of [...shallow, ...deep]) {
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(1);
    }
    // Every NORMAL stub-kill drop matches the per-map-tier qty formula exactly (no
    // boss bonus mixed in — these are all farm kills).
    const cfg = CONFIG.stoneDrops;
    const shallowQty = cfg.qtyBase; // map tier 1
    const deepQty = cfg.qtyBase + 5 * cfg.qtyPerMapTier; // map tier 6
    expect(deepQty).toBeGreaterThan(shallowQty);
    expect(new Set(shallow)).toEqual(new Set([shallowQty]));
    expect(new Set(deep)).toEqual(new Set([deepQty]));
  });
});

describe("stream isolation — gear drops stay byte-identical with stones enabled", () => {
  it("the itemDrop sequence matches a pure gear-only recomputation off (salt,counter)", () => {
    // Reference gear roll: replicate systems/gear.rollEnemyDrop's GEAR branch using
    // ONLY lootFloat + the stage's drop table + a counter that ticks once per kill.
    // If the stone roll perturbed the gear stream, this would diverge.
    const save = soloSave("archer", 3);
    const s = initGameState(4242, save);
    const salt = s.lootSalt;
    const log = collect(s, 4000);
    expect(log.gear.length).toBeGreaterThan(0);
    for (const g of log.gear) {
      const counter = Number(g.rollId);
      const r = lootFloat(salt, counter);
      const table = dropTableForStage(save.stage);
      let acc = 0;
      let expected: string | null = null;
      for (const entry of table) {
        acc += entry.chance;
        if (r < acc) {
          expected = entry.templateId;
          break;
        }
      }
      // Only counters that actually produced a gear drop appear in the log, so the
      // recomputed template must be present + equal.
      expect(expected).toBe(g.templateId);
    }
  });

  it("counter ticks exactly ONCE per kill (stones consume no extra tick)", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.spawnPaused = true; // isolate hand-placed kills from the spawn pool
    let kills = 0;
    for (let k = 0; k < 300; k++) {
      const e = makeStubEnemy(2000 + k, s.heroes[0].x + 5, 1);
      s.enemies = [e];
      s.heroes[0].cd = 0;
      const before = s.lootCounter;
      step(s, {});
      const dead = s.enemies.length === 0;
      if (dead) {
        kills++;
        // A single kill advances the counter by AT MOST 1 — a stone drop on the same
        // kill must not add a second tick.
        expect(s.lootCounter - before).toBeLessThanOrEqual(1);
      }
    }
    expect(kills).toBeGreaterThan(0);
    expect(s.lootCounter).toBe(kills); // exactly one tick per kill over the whole run
  });
});

describe("claim-key contract (server credits Character.materials idempotently)", () => {
  it("each stone's rollId is a monotonic loot-counter value shared with that kill's gear roll", () => {
    const s = initGameState(4242, soloSave("mage", 5));
    const log = collect(s, 4000);
    // Stone rollIds are unique (one kill = one counter tick = one rollId), so the
    // server key `${characterId}:stone:${rollId}` never collides → idempotent credit.
    const ids = log.stones.map((st) => st.rollId);
    expect(new Set(ids).size).toBe(ids.length);
    // Where a kill dropped BOTH gear and a stone, they carry the SAME rollId (shared
    // tick) — but the server namespaces them (`:stone:`) so the two claims don't clash.
    const gearIds = new Set(log.gear.map((g) => g.rollId));
    const shared = ids.filter((id) => gearIds.has(id));
    expect(shared.length).toBeGreaterThan(0); // some kills legitimately drop both
  });

  it("rollIds are disjoint across a save/load boundary (no re-roll / dupe claim)", () => {
    const s = initGameState(7, soloSave("archer", 3));
    const phase1 = collect(s, 3000).stones;
    const snapshot = toSaveData(s);
    const counterAtSave = s.lootCounter;
    expect(counterAtSave).toBeGreaterThan(0);

    const s2 = initGameState(99999, snapshot); // different session seed; salt+counter persist
    expect(s2.lootCounter).toBe(counterAtSave);
    expect(s2.lootSalt).toBe(s.lootSalt);
    const phase2 = collect(s2, 3000).stones;

    for (const st of phase1) expect(Number(st.rollId)).toBeLessThan(counterAtSave);
    for (const st of phase2) expect(Number(st.rollId)).toBeGreaterThanOrEqual(counterAtSave);
  });
});
