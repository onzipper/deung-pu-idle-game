import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import th from "../../../messages/th.json";
import {
  LATEST_PATCH_NOTES_ID,
  PATCH_NOTES,
  latestPatchNotes,
  resolvePatchNotesDecision,
  type PatchNotesDecisionInput,
} from "@/ui/patchNotes";

function input(overrides: Partial<PatchNotesDecisionInput> = {}): PatchNotesDecisionInput {
  return {
    seenId: null,
    latestId: LATEST_PATCH_NOTES_ID,
    isBrandNew: false,
    ...overrides,
  };
}

/** Reads a dot-path off a nested message object (mirrors onboarding tips' own test helper). */
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === "object" && seg in acc) {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, obj);
}

const messagesByLocale = { th: th.patchNotes, en: en.patchNotes };

describe("PATCH_NOTES registry", () => {
  it("is non-empty and LATEST_PATCH_NOTES_ID is the last entry's id", () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0);
    expect(LATEST_PATCH_NOTES_ID).toBe(PATCH_NOTES[PATCH_NOTES.length - 1].id);
    expect(latestPatchNotes().id).toBe(LATEST_PATCH_NOTES_ID);
  });

  it("has unique release ids", () => {
    const ids = PATCH_NOTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every release's item keys resolve to a string in both th.json and en.json", () => {
    for (const release of PATCH_NOTES) {
      expect(release.items.length).toBeGreaterThan(0);
      for (const key of release.items) {
        for (const [locale, messages] of Object.entries(messagesByLocale)) {
          expect(get(messages, key), `${locale}: patchNotes.${key}`).toBeTypeOf("string");
        }
      }
    }
  });

  it("title and ackButton exist in both locales", () => {
    for (const [locale, messages] of Object.entries(messagesByLocale)) {
      expect(get(messages, "title"), `${locale}: patchNotes.title`).toBeTypeOf("string");
      expect(get(messages, "ackButton"), `${locale}: patchNotes.ackButton`).toBeTypeOf(
        "string",
      );
    }
  });
});

describe("resolvePatchNotesDecision", () => {
  it("returns 'none' when the seen id already matches the latest release", () => {
    expect(resolvePatchNotesDecision(input({ seenId: LATEST_PATCH_NOTES_ID }))).toBe("none");
  });

  it("returns 'none' even for a brand-new player who's already seen the latest id", () => {
    expect(
      resolvePatchNotesDecision(
        input({ seenId: LATEST_PATCH_NOTES_ID, isBrandNew: true }),
      ),
    ).toBe("none");
  });

  it("returns 'recordOnly' for a brand-new player who hasn't seen it yet (never shows, never stacks with FTUE)", () => {
    expect(resolvePatchNotesDecision(input({ seenId: null, isBrandNew: true }))).toBe(
      "recordOnly",
    );
    expect(
      resolvePatchNotesDecision(input({ seenId: "2020-01-01", isBrandNew: true })),
    ).toBe("recordOnly");
  });

  it("returns 'show' for a returning player who hasn't seen the latest release", () => {
    expect(resolvePatchNotesDecision(input({ seenId: null, isBrandNew: false }))).toBe(
      "show",
    );
    expect(
      resolvePatchNotesDecision(input({ seenId: "2020-01-01", isBrandNew: false })),
    ).toBe("show");
  });

  it("a stale seenId from an OLDER release still shows (only an exact match to latest suppresses it)", () => {
    expect(
      resolvePatchNotesDecision(
        input({ seenId: "2026-01-01", latestId: "2026-07-07", isBrandNew: false }),
      ),
    ).toBe("show");
  });
});
