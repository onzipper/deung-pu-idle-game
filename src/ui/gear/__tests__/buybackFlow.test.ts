import { describe, expect, it } from "vitest";
import { formatBuybackCountdown, normalizeBuybackReason } from "@/ui/gear/buybackFlow";

describe("normalizeBuybackReason", () => {
  it("passes through every known contract reason unchanged", () => {
    expect(normalizeBuybackReason("notFound")).toBe("notFound");
    expect(normalizeBuybackReason("expired")).toBe("expired");
    expect(normalizeBuybackReason("insufficientGold")).toBe("insufficientGold");
    expect(normalizeBuybackReason("bagFull")).toBe("bagFull");
  });

  it("maps the client-side network failure to its own reason", () => {
    expect(normalizeBuybackReason("network")).toBe("network");
  });

  it("collapses anything unrecognized (or missing) to unknown", () => {
    expect(normalizeBuybackReason("somethingNew")).toBe("unknown");
    expect(normalizeBuybackReason(undefined)).toBe("unknown");
  });
});

describe("formatBuybackCountdown", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");

  it("reports days+hours once a day or more remains", () => {
    const expires = new Date(now + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString();
    expect(formatBuybackCountdown(expires, now)).toEqual({
      unit: "days",
      params: { d: 2, h: 3 },
    });
  });

  it("reports hours+minutes once under a day remains", () => {
    const expires = new Date(now + 5 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    expect(formatBuybackCountdown(expires, now)).toEqual({
      unit: "hours",
      params: { h: 5, m: 30 },
    });
  });

  it("reports minutes-only once under an hour remains (more precise near the end)", () => {
    const expires = new Date(now + 45 * 60 * 1000).toISOString();
    expect(formatBuybackCountdown(expires, now)).toEqual({
      unit: "minutes",
      params: { m: 45 },
    });
  });

  it("treats an already-past expiresAt as expired", () => {
    const expires = new Date(now - 1000).toISOString();
    expect(formatBuybackCountdown(expires, now)).toEqual({ unit: "expired", params: {} });
  });

  it("treats an unparseable expiresAt as expired rather than throwing", () => {
    expect(formatBuybackCountdown("not-a-date", now)).toEqual({ unit: "expired", params: {} });
  });
});
