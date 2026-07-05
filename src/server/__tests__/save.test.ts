import { describe, it, expect } from "vitest";
import { parseSaveData } from "@/server/save";
import { SAVE_VERSION, SPEED_UPGRADE_CAP, CONFIG } from "@/engine";

/**
 * Validation is the server's trust boundary: `parseSaveData` is the pure gate
 * every incoming save passes before it can touch the DB. These exercise the
 * accept/reject rules headlessly (no DB, no mocks).
 */

/** A minimal well-formed payload a well-behaved client would POST. */
function validSave(overrides: Record<string, unknown> = {}) {
  return {
    version: SAVE_VERSION,
    stage: 3,
    gold: 500,
    unlocked: ["swordsman", "archer"],
    upgrades: { atk: 2, speed: 1, hp: 3 },
    heroes: [
      { level: 1, xp: 0, tier: 1 },
      { level: 4, xp: 12, tier: 2 },
    ],
    lastSeen: 0,
    ...overrides,
  };
}

describe("parseSaveData — accepts", () => {
  it("accepts a well-formed save and normalises it through migrate()", () => {
    const r = parseSaveData(validSave());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.version).toBe(SAVE_VERSION);
      expect(r.data.stage).toBe(3);
      expect(r.data.gold).toBe(500);
      expect(r.data.unlocked).toEqual(["swordsman", "archer"]);
    }
  });

  it("accepts a save with lastSeen omitted (server owns it)", () => {
    const save = validSave();
    delete (save as Record<string, unknown>).lastSeen;
    expect(parseSaveData(save).ok).toBe(true);
  });

  it("accepts the speed line exactly at the cap", () => {
    const r = parseSaveData(validSave({ upgrades: { atk: 0, speed: SPEED_UPGRADE_CAP, hp: 0 } }));
    expect(r.ok).toBe(true);
  });

  it("accepts a full roster of maxHeroes classes", () => {
    const r = parseSaveData(validSave({ unlocked: ["swordsman", "archer", "mage"] }));
    expect(r.ok).toBe(true);
  });
});

describe("parseSaveData — rejects", () => {
  it("rejects a wrong version", () => {
    expect(parseSaveData(validSave({ version: SAVE_VERSION + 1 })).ok).toBe(false);
    expect(parseSaveData(validSave({ version: 0 })).ok).toBe(false);
  });

  it("rejects negative gold", () => {
    expect(parseSaveData(validSave({ gold: -1 })).ok).toBe(false);
  });

  it("rejects stage below 1", () => {
    expect(parseSaveData(validSave({ stage: 0 })).ok).toBe(false);
    expect(parseSaveData(validSave({ stage: -5 })).ok).toBe(false);
  });

  it("rejects non-integer stage", () => {
    expect(parseSaveData(validSave({ stage: 2.5 })).ok).toBe(false);
  });

  it("rejects negative upgrade levels", () => {
    expect(parseSaveData(validSave({ upgrades: { atk: -1, speed: 0, hp: 0 } })).ok).toBe(false);
  });

  it("rejects a speed line above the cap", () => {
    expect(
      parseSaveData(validSave({ upgrades: { atk: 0, speed: SPEED_UPGRADE_CAP + 1, hp: 0 } })).ok,
    ).toBe(false);
  });

  it("rejects a hero tier outside 1..2", () => {
    expect(parseSaveData(validSave({ heroes: [{ level: 1, xp: 0, tier: 0 }] })).ok).toBe(false);
    expect(parseSaveData(validSave({ heroes: [{ level: 1, xp: 0, tier: 3 }] })).ok).toBe(false);
  });

  it("rejects an unknown hero class", () => {
    expect(parseSaveData(validSave({ unlocked: ["swordsman", "necromancer"] })).ok).toBe(false);
  });

  it("rejects more unlocked than maxHeroes", () => {
    const tooMany = Array(CONFIG.maxHeroes + 1).fill("swordsman");
    expect(parseSaveData(validSave({ unlocked: tooMany })).ok).toBe(false);
  });

  it("rejects duplicate unlocked classes (would forge extra slots)", () => {
    expect(parseSaveData(validSave({ unlocked: ["swordsman", "swordsman"] })).ok).toBe(false);
  });

  it("rejects an empty unlocked list", () => {
    expect(parseSaveData(validSave({ unlocked: [] })).ok).toBe(false);
  });

  it("rejects unknown extra keys (strict shape)", () => {
    expect(parseSaveData(validSave({ hacked: true })).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(parseSaveData(null).ok).toBe(false);
    expect(parseSaveData("nope").ok).toBe(false);
    expect(parseSaveData(42).ok).toBe(false);
  });

  it("rejects NaN / Infinity gold", () => {
    expect(parseSaveData(validSave({ gold: Number.NaN })).ok).toBe(false);
    expect(parseSaveData(validSave({ gold: Number.POSITIVE_INFINITY })).ok).toBe(false);
  });

  it("surfaces a field-scoped error message on rejection", () => {
    const r = parseSaveData(validSave({ gold: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("gold");
  });
});
