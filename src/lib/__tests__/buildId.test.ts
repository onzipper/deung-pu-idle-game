import { afterEach, describe, expect, it } from "vitest";
import { resolveBuildId } from "@/lib/buildId";

const ENV_KEY = "NEXT_PUBLIC_BUILD_ID";

describe("resolveBuildId", () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("prefers an already-set NEXT_PUBLIC_BUILD_ID over any fallback", () => {
    process.env[ENV_KEY] = "pinned-by-ci";
    expect(resolveBuildId()).toBe("pinned-by-ci");
  });

  it("falls back to a non-empty string (git sha or timestamp) when unset", () => {
    delete process.env[ENV_KEY];
    const id = resolveBuildId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
