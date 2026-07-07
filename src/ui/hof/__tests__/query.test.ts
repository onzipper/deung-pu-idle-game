import { describe, expect, it } from "vitest";
import { buildHofUrl, hofQueryKey } from "@/ui/hof/query";
import type { HofQuery } from "@/ui/hof/types";

function query(overrides: Partial<HofQuery> = {}): HofQuery {
  return { board: "level", bossStage: 5, cls: "all", ...overrides };
}

describe("hofQueryKey", () => {
  it("folds bossStage out of the key for non-boss boards", () => {
    expect(hofQueryKey(query({ board: "gold", bossStage: 5 }))).toBe(
      hofQueryKey(query({ board: "gold", bossStage: 30 })),
    );
  });

  it("distinguishes boss boards by stage", () => {
    expect(hofQueryKey(query({ board: "boss", bossStage: 5 }))).not.toBe(
      hofQueryKey(query({ board: "boss", bossStage: 10 })),
    );
  });

  it("distinguishes by class filter", () => {
    expect(hofQueryKey(query({ cls: "archer" }))).not.toBe(
      hofQueryKey(query({ cls: "mage" })),
    );
  });

  it("is stable for structurally-identical queries", () => {
    expect(hofQueryKey(query({ board: "power", cls: "swordsman" }))).toBe(
      hofQueryKey(query({ board: "power", cls: "swordsman" })),
    );
  });
});

describe("buildHofUrl", () => {
  it("omits bossStage for non-boss boards", () => {
    const url = buildHofUrl(query({ board: "online", bossStage: 15, cls: "mage" }));
    expect(url).toBe("/api/hof?board=online&cls=mage");
  });

  it("includes bossStage for the boss board", () => {
    const url = buildHofUrl(query({ board: "boss", bossStage: 20, cls: "all" }));
    expect(url).toBe("/api/hof?board=boss&cls=all&bossStage=20");
  });
});
