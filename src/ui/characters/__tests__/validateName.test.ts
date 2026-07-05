import { describe, expect, it } from "vitest";
import { validateCharacterName } from "@/ui/characters/validateName";

describe("validateCharacterName", () => {
  it("accepts a plain English name", () => {
    expect(validateCharacterName("Hero1")).toEqual({ ok: true, trimmed: "Hero1" });
  });

  it("accepts a plain Thai name", () => {
    const result = validateCharacterName("นักดาบ");
    expect(result.ok).toBe(true);
    expect(result.trimmed).toBe("นักดาบ");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateCharacterName("  Hero1  ")).toEqual({ ok: true, trimmed: "Hero1" });
  });

  it("rejects empty / whitespace-only input", () => {
    expect(validateCharacterName("").error).toBe("empty");
    expect(validateCharacterName("   ").error).toBe("empty");
  });

  it("rejects a single character (below the 2-char minimum)", () => {
    expect(validateCharacterName("A").error).toBe("tooShort");
  });

  it("accepts exactly 2 characters", () => {
    expect(validateCharacterName("Ab").ok).toBe(true);
  });

  it("rejects more than 24 characters", () => {
    expect(validateCharacterName("A".repeat(25)).error).toBe("tooLong");
  });

  it("accepts exactly 24 characters", () => {
    expect(validateCharacterName("A".repeat(24)).ok).toBe(true);
  });

  it("rejects spaces inside the name", () => {
    expect(validateCharacterName("Hero One").error).toBe("invalidChars");
  });

  it("rejects punctuation/symbols", () => {
    expect(validateCharacterName("Hero!").error).toBe("invalidChars");
    expect(validateCharacterName("Hero_1").error).toBe("invalidChars");
    expect(validateCharacterName("โจ๊ก#1").error).toBe("invalidChars");
  });

  it("accepts mixed Thai/EN alphanumerics", () => {
    expect(validateCharacterName("นักดาบ99").ok).toBe(true);
  });
});
