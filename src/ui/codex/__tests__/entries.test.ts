import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import th from "../../../../messages/th.json";
import {
  CODEX_CATEGORIES,
  CODEX_ENTRIES,
  codexEntriesByCategory,
  codexEntryRequiredKeys,
} from "@/ui/codex/entries";

/** Reads a dot-path (e.g. "entries.boss.title") off a nested message object;
 * returns undefined if any segment is missing (mirrors next-intl's own
 * "key not found" failure mode). */
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === "object" && seg in acc) {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, obj);
}

const messagesByLocale = { th: th.codex, en: en.codex };

describe("CODEX_CATEGORIES", () => {
  it("is non-empty", () => {
    expect(CODEX_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("every category has at least one entry", () => {
    for (const category of CODEX_CATEGORIES) {
      expect(codexEntriesByCategory(category.id).length).toBeGreaterThan(0);
    }
  });

  it("every category has a label key in both message files", () => {
    for (const category of CODEX_CATEGORIES) {
      for (const [locale, messages] of Object.entries(messagesByLocale)) {
        expect(get(messages, `categories.${category.id}`), `${locale}: categories.${category.id}`).toBeTypeOf(
          "string",
        );
      }
    }
  });

  it("every entry references a declared category", () => {
    const ids = new Set(CODEX_CATEGORIES.map((c) => c.id));
    for (const entry of CODEX_ENTRIES) {
      expect(ids.has(entry.category)).toBe(true);
    }
  });
});

describe("CODEX_ENTRIES", () => {
  it("is non-empty", () => {
    expect(CODEX_ENTRIES.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = CODEX_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every required i18n key resolves in both th.json and en.json", () => {
    for (const entry of CODEX_ENTRIES) {
      for (const key of codexEntryRequiredKeys(entry)) {
        for (const [locale, messages] of Object.entries(messagesByLocale)) {
          expect(get(messages, key), `${locale}: codex.${key}`).toBeTypeOf("string");
        }
      }
    }
  });

  it("contentRef entries do NOT redeclare a title (title comes from `content`)", () => {
    for (const entry of CODEX_ENTRIES) {
      if (!entry.contentRef) continue;
      expect(get(th.codex, `entries.${entry.id}.title`)).toBeUndefined();
      expect(get(en.codex, `entries.${entry.id}.title`)).toBeUndefined();
    }
  });

  it("heroClass contentRef ids resolve against the shared `content.classes` namespace", () => {
    for (const entry of CODEX_ENTRIES) {
      if (entry.contentRef?.kind !== "heroClass") continue;
      expect(get(th.content, `classes.${entry.contentRef.id}.name`)).toBeTypeOf("string");
      expect(get(en.content, `classes.${entry.contentRef.id}.name`)).toBeTypeOf("string");
    }
  });
});

describe("codex panel chrome keys", () => {
  it("openButton/title/closeButton/replayTutorialButton exist in both locales", () => {
    for (const key of ["openButton", "title", "closeButton", "replayTutorialButton"]) {
      expect(get(th.codex, key), `th: codex.${key}`).toBeTypeOf("string");
      expect(get(en.codex, key), `en: codex.${key}`).toBeTypeOf("string");
    }
  });
});
