import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import th from "../../../../messages/th.json";
import { ITEM_TEMPLATES } from "@/engine";

/** M7 Gear & Drops: every catalog template needs a `content.items.<id>.name`
 * display string in BOTH locales (th/en parity is test-enforced — same
 * pattern as `codex/__tests__/entries.test.ts`). */
describe("gear catalog i18n coverage", () => {
  const ids = Object.keys(ITEM_TEMPLATES);

  it("has exactly 27 catalog templates (frozen contract — see config/items.ts)", () => {
    expect(ids.length).toBe(27);
  });

  it("every templateId resolves a `content.items.<id>.name` string in both locales", () => {
    for (const id of ids) {
      expect(
        (th.content.items as Record<string, { name?: string }>)[id]?.name,
        `th: content.items.${id}.name`,
      ).toBeTypeOf("string");
      expect(
        (en.content.items as Record<string, { name?: string }>)[id]?.name,
        `en: content.items.${id}.name`,
      ).toBeTypeOf("string");
    }
  });
});
