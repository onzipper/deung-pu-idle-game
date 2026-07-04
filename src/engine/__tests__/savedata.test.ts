import { describe, it, expect } from "vitest";
import {
  SAVE_VERSION,
  SLOT_ORDER,
  initGameState,
  toSaveData,
  step,
} from "@/engine";
import { threeHeroSave } from "./helpers";

/**
 * `toSaveData` is the inverse of `initGameState(seed, save)` — it serialises the
 * live state back down to the persisted subset. It is the client's source of
 * truth for what gets POSTed, so its shape must stay canonical.
 */
describe("toSaveData", () => {
  it("emits the current SAVE_VERSION and a server-owned lastSeen of 0", () => {
    const s = initGameState(1);
    const save = toSaveData(s);
    expect(save.version).toBe(SAVE_VERSION);
    // Client must not stamp wall-clock time — the server owns lastSeen.
    expect(save.lastSeen).toBe(0);
  });

  it("derives `unlocked` from the unlocked slot count via SLOT_ORDER", () => {
    const cold = toSaveData(initGameState(1));
    expect(cold.unlocked).toEqual([SLOT_ORDER[0]]); // 1 slot cold-start

    const full = toSaveData(initGameState(1, threeHeroSave()));
    expect(full.unlocked).toEqual([...SLOT_ORDER]); // all 3 slots
  });

  it("round-trips progress + economy through initGameState", () => {
    const original = threeHeroSave(5);
    original.gold = 1234;
    original.upgrades = { atk: 3, speed: 2, hp: 4 };

    const restored = toSaveData(initGameState(9, original));
    expect(restored.stage).toBe(original.stage);
    expect(restored.gold).toBe(original.gold);
    expect(restored.upgrades).toEqual(original.upgrades);
    expect(restored.unlocked).toEqual(original.unlocked);
  });

  it("captures gold/stage advanced by the live sim", () => {
    const s = initGameState(7, threeHeroSave());
    s.gold = 42;
    step(s, {});
    expect(toSaveData(s).gold).toBe(42);
  });
});
