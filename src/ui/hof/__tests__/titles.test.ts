import { describe, expect, it } from "vitest";
import { HOF_REWARD_BOARDS, isKnownTitleId, titleI18nKey, titleLabel } from "@/ui/hof/titles";

const ALL_12_IDS = HOF_REWARD_BOARDS.flatMap((board) => [1, 2, 3].map((rank) => `${board}.${rank}`));

describe("isKnownTitleId / titleI18nKey", () => {
  it("recognizes all 12 structural ids (4 reward boards x rank 1-3)", () => {
    expect(ALL_12_IDS).toHaveLength(12);
    for (const id of ALL_12_IDS) {
      expect(isKnownTitleId(id)).toBe(true);
      expect(titleI18nKey(id)).toBe(`titles.${id}`);
    }
  });

  it("rejects an unknown/foreign id", () => {
    expect(isKnownTitleId("boss.1")).toBe(false); // boss-time is excluded from rewards v1
    expect(isKnownTitleId("level.4")).toBe(false); // rank 4 was never minted
    expect(isKnownTitleId("level")).toBe(false);
    expect(isKnownTitleId("")).toBe(false);
    expect(titleI18nKey("boss.1")).toBeNull();
    expect(titleI18nKey("level.4")).toBeNull();
  });

  it("titleI18nKey is null for null/undefined input", () => {
    expect(titleI18nKey(null)).toBeNull();
    expect(titleI18nKey(undefined)).toBeNull();
  });
});

describe("titleLabel", () => {
  const t = (key: string) => `LOCALIZED(${key})`;

  it("joins a known id with the translator", () => {
    expect(titleLabel("level.1", t)).toBe("LOCALIZED(titles.level.1)");
    expect(titleLabel("online.3", t)).toBe("LOCALIZED(titles.online.3)");
  });

  it("returns null for an unknown id or no id, never calling the translator", () => {
    let called = false;
    const spy = (key: string) => {
      called = true;
      return key;
    };
    expect(titleLabel("nope", spy)).toBeNull();
    expect(titleLabel(null, spy)).toBeNull();
    expect(titleLabel(undefined, spy)).toBeNull();
    expect(called).toBe(false);
  });
});
