import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import th from "../../../messages/th.json";
import {
  DISMISS_COOLDOWN_MS,
  resolveUpdateBannerDecision,
  type UpdateBannerDecisionInput,
} from "@/ui/updateBanner";

function input(overrides: Partial<UpdateBannerDecisionInput> = {}): UpdateBannerDecisionInput {
  return {
    clientBuildId: "abc123",
    serverBuildId: null,
    dismissedForId: null,
    dismissedAt: null,
    now: 1_000_000,
    ...overrides,
  };
}

const messagesByLocale = { th: th.updateBanner, en: en.updateBanner };

describe("updateBanner i18n", () => {
  it("message/button/buttonTooltip/closeButton exist in both locales", () => {
    for (const [locale, messages] of Object.entries(messagesByLocale)) {
      expect(messages.message, `${locale}: updateBanner.message`).toBeTypeOf("string");
      expect(messages.button, `${locale}: updateBanner.button`).toBeTypeOf("string");
      expect(messages.buttonTooltip, `${locale}: updateBanner.buttonTooltip`).toBeTypeOf(
        "string",
      );
      expect(messages.closeButton, `${locale}: updateBanner.closeButton`).toBeTypeOf("string");
    }
  });
});

describe("resolveUpdateBannerDecision", () => {
  it("hides when the server id is unknown (pre-boot)", () => {
    expect(resolveUpdateBannerDecision(input({ serverBuildId: null }))).toBe("hide");
  });

  it("hides when the server id matches this client's own build id", () => {
    expect(
      resolveUpdateBannerDecision(input({ clientBuildId: "abc123", serverBuildId: "abc123" })),
    ).toBe("hide");
  });

  it("shows on a fresh mismatch that has never been dismissed", () => {
    expect(
      resolveUpdateBannerDecision(
        input({ clientBuildId: "abc123", serverBuildId: "def456" }),
      ),
    ).toBe("show");
  });

  it("hides the SAME mismatch while inside the dismiss cooldown window", () => {
    expect(
      resolveUpdateBannerDecision(
        input({
          serverBuildId: "def456",
          dismissedForId: "def456",
          dismissedAt: 1_000_000 - 5_000,
          now: 1_000_000,
        }),
      ),
    ).toBe("hide");
  });

  it("shows again once the cooldown has fully elapsed", () => {
    expect(
      resolveUpdateBannerDecision(
        input({
          serverBuildId: "def456",
          dismissedForId: "def456",
          dismissedAt: 1_000_000 - DISMISS_COOLDOWN_MS,
          now: 1_000_000,
        }),
      ),
    ).toBe("show");
    expect(
      resolveUpdateBannerDecision(
        input({
          serverBuildId: "def456",
          dismissedForId: "def456",
          dismissedAt: 1_000_000 - (DISMISS_COOLDOWN_MS + 1),
          now: 1_000_000,
        }),
      ),
    ).toBe("show");
  });

  it("a NEWER mismatch interrupts an open cooldown for an OLDER one", () => {
    expect(
      resolveUpdateBannerDecision(
        input({
          serverBuildId: "ghi789", // a newer deploy landed since the dismiss
          dismissedForId: "def456",
          dismissedAt: 1_000_000 - 1_000, // well inside the cooldown for def456
          now: 1_000_000,
        }),
      ),
    ).toBe("show");
  });

  it("a dismiss recorded but no server id mismatch (already updated) still hides", () => {
    expect(
      resolveUpdateBannerDecision(
        input({
          clientBuildId: "abc123",
          serverBuildId: "abc123",
          dismissedForId: "def456",
          dismissedAt: 1_000_000 - 1_000,
          now: 1_000_000,
        }),
      ),
    ).toBe("hide");
  });
});
