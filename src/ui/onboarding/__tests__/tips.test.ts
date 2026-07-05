import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import th from "../../../../messages/th.json";
import {
  CONTEXTUAL_TIPS,
  resolveTriggeredTip,
  tipById,
  tipRequiredKeys,
  type ContextualTipDef,
} from "@/ui/onboarding/tips";
import type { OnboardingSnapshot } from "@/ui/onboarding/steps";

function snapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    gold: 0,
    stage: 1,
    kills: 0,
    phase: "battle",
    autoCast: false,
    // Non-zero cooldown so a bare `snapshot()` is a true "nothing to report"
    // baseline (autoCastAvailable's trigger checks "any hero ready", which a
    // bare `skillCd: 0` would satisfy by default).
    heroes: [{ skillCd: 1, dead: false }],
    ...overrides,
  };
}

/** Reads a dot-path off a nested message object (mirrors codex's own test helper). */
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === "object" && seg in acc) {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, obj);
}

const messagesByLocale = { th: th.onboarding, en: en.onboarding };

function idOf(id: string): ContextualTipDef {
  const tip = tipById(id);
  if (!tip) throw new Error(`missing tip: ${id}`);
  return tip;
}

describe("CONTEXTUAL_TIPS registry", () => {
  it("is non-empty and has unique ids", () => {
    expect(CONTEXTUAL_TIPS.length).toBeGreaterThan(0);
    const ids = CONTEXTUAL_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every tip's title/body key resolves in both th.json and en.json", () => {
    for (const tip of CONTEXTUAL_TIPS) {
      for (const key of tipRequiredKeys(tip)) {
        for (const [locale, messages] of Object.entries(messagesByLocale)) {
          expect(get(messages, key), `${locale}: onboarding.${key}`).toBeTypeOf("string");
        }
      }
    }
  });

  it("mascotName and tipDismissButton exist in both locales", () => {
    for (const [locale, messages] of Object.entries(messagesByLocale)) {
      expect(get(messages, "mascotName"), `${locale}: onboarding.mascotName`).toBeTypeOf(
        "string",
      );
      expect(
        get(messages, "tipDismissButton"),
        `${locale}: onboarding.tipDismissButton`,
      ).toBeTypeOf("string");
    }
  });
});

describe("individual tip triggers", () => {
  it("heroDeathRespawn fires the instant any hero is dead", () => {
    const tip = idOf("heroDeathRespawn");
    const prev = snapshot();
    const alive = snapshot();
    const oneDead = snapshot({ heroes: [{ skillCd: 0, dead: true }] });
    expect(tip.trigger(prev, alive)).toBe(false);
    expect(tip.trigger(prev, oneDead)).toBe(true);
  });

  it("autoCastAvailable fires once a hero is off cooldown, only while autoCast is off", () => {
    const tip = idOf("autoCastAvailable");
    const prev = snapshot();
    const onCooldown = snapshot({ heroes: [{ skillCd: 4, dead: false }] });
    const ready = snapshot({ heroes: [{ skillCd: 0, dead: false }] });
    const readyButAutomated = snapshot({
      autoCast: true,
      heroes: [{ skillCd: 0, dead: false }],
    });
    expect(tip.trigger(prev, onCooldown)).toBe(false);
    expect(tip.trigger(prev, ready)).toBe(true);
    expect(tip.trigger(prev, readyButAutomated)).toBe(false);
  });

  it("stageClear fires the instant phase becomes victory", () => {
    const tip = idOf("stageClear");
    const prev = snapshot({ phase: "boss" });
    const stillBoss = snapshot({ phase: "boss" });
    const cleared = snapshot({ phase: "victory" });
    expect(tip.trigger(prev, stillBoss)).toBe(false);
    expect(tip.trigger(prev, cleared)).toBe(true);
  });

  it("bossWipe fires only on the boss -> battle edge, not battle at boot", () => {
    const tip = idOf("bossWipe");
    const bootPrev = snapshot({ phase: "battle" });
    const bootNext = snapshot({ phase: "battle" });
    const wipePrev = snapshot({ phase: "boss" });
    const wipeNext = snapshot({ phase: "battle" });
    expect(tip.trigger(bootPrev, bootNext)).toBe(false);
    expect(tip.trigger(wipePrev, wipeNext)).toBe(true);
  });
});

describe("resolveTriggeredTip", () => {
  it("returns null when nothing triggers", () => {
    const prev = snapshot();
    const next = snapshot();
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, new Set(), prev, next)).toBeNull();
  });

  it("returns the first not-yet-seen tip whose trigger fires (registry-order priority)", () => {
    // A party where one hero is dead AND another is skill-ready fires BOTH
    // heroDeathRespawn and autoCastAvailable; heroDeathRespawn is earlier, so it wins.
    const prev = snapshot();
    const next = snapshot({
      heroes: [
        { skillCd: 0, dead: true },
        { skillCd: 0, dead: false },
      ],
    });
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, new Set(), prev, next)).toBe(
      "heroDeathRespawn",
    );
  });

  it("never re-returns an id already marked seen (once-only)", () => {
    const prev = snapshot();
    const next = snapshot({ heroes: [{ skillCd: 1, dead: true }] });
    const seen = new Set(["heroDeathRespawn"]);
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, seen, prev, next)).toBeNull();
  });

  it("falls through to the next eligible tip once an earlier one is seen", () => {
    const prev = snapshot();
    const next = snapshot({
      heroes: [
        { skillCd: 0, dead: true },
        { skillCd: 0, dead: false },
      ],
    });
    const seen = new Set(["heroDeathRespawn"]);
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, seen, prev, next)).toBe(
      "autoCastAvailable",
    );
  });
});
