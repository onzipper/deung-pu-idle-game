import { describe, it, expect } from "vitest";
import { parseSaveData } from "@/server/save";
import { SAVE_VERSION, CONFIG } from "@/engine";

/**
 * Validation is the server's trust boundary: `parseSaveData` is the pure gate
 * every incoming save passes before it can touch the DB. M5 v4: the payload is a
 * single character (`hero: {cls, level, xp, tier}`) — the upgrade lines / unlocked
 * roster are gone. These exercise the accept/reject rules headlessly (no DB).
 */

/** A minimal well-formed v4 payload a well-behaved client would POST. */
function validSave(overrides: Record<string, unknown> = {}) {
  return {
    version: SAVE_VERSION,
    stage: 3,
    gold: 500,
    hero: { cls: "archer", level: 4, xp: 12, tier: 2 },
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
      expect(r.data.hero).toEqual({ cls: "archer", level: 4, xp: 12, tier: 2 });
    }
  });

  it("accepts a save with lastSeen omitted (server owns it)", () => {
    const save = validSave();
    delete (save as Record<string, unknown>).lastSeen;
    expect(parseSaveData(save).ok).toBe(true);
  });

  it("accepts a hero at the level cap", () => {
    const r = parseSaveData(
      validSave({ hero: { cls: "mage", level: CONFIG.leveling.levelCap, xp: 0, tier: 1 } }),
    );
    expect(r.ok).toBe(true);
  });

  it.each(["swordsman", "archer", "mage"])("accepts the %s base class", (cls) => {
    expect(parseSaveData(validSave({ hero: { cls, level: 1, xp: 0, tier: 1 } })).ok).toBe(true);
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

  it("rejects a hero level below 1 or above the cap", () => {
    expect(parseSaveData(validSave({ hero: { cls: "archer", level: 0, xp: 0, tier: 1 } })).ok).toBe(
      false,
    );
    expect(
      parseSaveData(
        validSave({ hero: { cls: "archer", level: CONFIG.leveling.levelCap + 1, xp: 0, tier: 1 } }),
      ).ok,
    ).toBe(false);
  });

  it("rejects negative xp", () => {
    expect(parseSaveData(validSave({ hero: { cls: "archer", level: 4, xp: -1, tier: 1 } })).ok).toBe(
      false,
    );
  });

  it("rejects a hero tier outside 1..2", () => {
    expect(parseSaveData(validSave({ hero: { cls: "archer", level: 1, xp: 0, tier: 0 } })).ok).toBe(
      false,
    );
    expect(parseSaveData(validSave({ hero: { cls: "archer", level: 1, xp: 0, tier: 3 } })).ok).toBe(
      false,
    );
  });

  it("rejects an unknown hero class", () => {
    expect(
      parseSaveData(validSave({ hero: { cls: "necromancer", level: 1, xp: 0, tier: 1 } })).ok,
    ).toBe(false);
  });

  it("rejects a missing hero", () => {
    const save = validSave();
    delete (save as Record<string, unknown>).hero;
    expect(parseSaveData(save).ok).toBe(false);
  });

  it("rejects unknown extra keys on the hero (strict shape)", () => {
    expect(
      parseSaveData(validSave({ hero: { cls: "archer", level: 1, xp: 0, tier: 1, hp: 999 } })).ok,
    ).toBe(false);
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
