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
    autoAllocate: false,
    // Non-zero cooldown so a bare `snapshot()` is a true "nothing to report"
    // baseline (autoCastAvailable's trigger checks "any hero ready", which a
    // bare `skillCd: 0` would satisfy by default).
    heroes: [
      {
        skillCd: 1,
        dead: false,
        statsSum: 0,
        statPoints: 0,
        unlockedSlots: 1,
        autoSlotsFilled: 0,
        questOffered: false,
        questComplete: false,
      },
    ],
    ...overrides,
  };
}

/** Merges a partial hero override onto the default hero shape (mirrors the
 * base `snapshot()` hero, index 0) — keeps individual test cases terse. */
function hero(overrides: Partial<OnboardingSnapshot["heroes"][number]> = {}) {
  return { ...snapshot().heroes[0], ...overrides };
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
    const oneDead = snapshot({ heroes: [hero({ skillCd: 0, dead: true })] });
    expect(tip.trigger(prev, alive)).toBe(false);
    expect(tip.trigger(prev, oneDead)).toBe(true);
  });

  it("autoCastAvailable fires once a hero is off cooldown, only while autoCast is off", () => {
    const tip = idOf("autoCastAvailable");
    const prev = snapshot();
    const onCooldown = snapshot({ heroes: [hero({ skillCd: 4 })] });
    const ready = snapshot({ heroes: [hero({ skillCd: 0 })] });
    const readyButAutomated = snapshot({
      autoCast: true,
      heroes: [hero({ skillCd: 0 })],
    });
    expect(tip.trigger(prev, onCooldown)).toBe(false);
    expect(tip.trigger(prev, ready)).toBe(true);
    expect(tip.trigger(prev, readyButAutomated)).toBe(false);
  });

  it("questOffered fires the instant the class-change quest is offered", () => {
    const tip = idOf("questOffered");
    const prev = snapshot();
    const notYet = snapshot();
    const offered = snapshot({ heroes: [hero({ questOffered: true })] });
    expect(tip.trigger(prev, notYet)).toBe(false);
    expect(tip.trigger(prev, offered)).toBe(true);
  });

  it("questComplete fires the instant the class-change quest is complete", () => {
    const tip = idOf("questComplete");
    const prev = snapshot();
    const notYet = snapshot();
    const complete = snapshot({ heroes: [hero({ questComplete: true })] });
    expect(tip.trigger(prev, notYet)).toBe(false);
    expect(tip.trigger(prev, complete)).toBe(true);
  });

  it("autoSlotUnlocked fires only when a hero's unlocked-slot count rises", () => {
    const tip = idOf("autoSlotUnlocked");
    const prev = snapshot({ heroes: [hero({ unlockedSlots: 1 })] });
    const unchanged = snapshot({ heroes: [hero({ unlockedSlots: 1 })] });
    const unlocked = snapshot({ heroes: [hero({ unlockedSlots: 2 })] });
    expect(tip.trigger(prev, unchanged)).toBe(false);
    expect(tip.trigger(prev, unlocked)).toBe(true);
  });

  it("statPointsPiling fires past the threshold only while auto-allocate is off", () => {
    const tip = idOf("statPointsPiling");
    const prev = snapshot();
    const belowThreshold = snapshot({ heroes: [hero({ statPoints: 9 })] });
    const piledUp = snapshot({ heroes: [hero({ statPoints: 10 })] });
    const piledUpButAutomated = snapshot({
      autoAllocate: true,
      heroes: [hero({ statPoints: 10 })],
    });
    expect(tip.trigger(prev, belowThreshold)).toBe(false);
    expect(tip.trigger(prev, piledUp)).toBe(true);
    expect(tip.trigger(prev, piledUpButAutomated)).toBe(false);
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
    // A hero that's skill-ready AND has stat points piled up fires BOTH
    // autoCastAvailable and statPointsPiling; autoCastAvailable is earlier
    // in the registry, so it wins (heroDeathRespawn doesn't apply — a solo
    // hero can't be simultaneously dead AND skill-ready).
    const prev = snapshot();
    const next = snapshot({ heroes: [hero({ skillCd: 0, statPoints: 10 })] });
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, new Set(), prev, next)).toBe(
      "autoCastAvailable",
    );
  });

  it("never re-returns an id already marked seen (once-only)", () => {
    const prev = snapshot();
    const next = snapshot({ heroes: [hero({ skillCd: 1, dead: true })] });
    const seen = new Set(["heroDeathRespawn"]);
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, seen, prev, next)).toBeNull();
  });

  it("falls through to the next eligible tip once an earlier one is seen", () => {
    const prev = snapshot();
    const next = snapshot({ heroes: [hero({ skillCd: 0, statPoints: 10 })] });
    const seen = new Set(["autoCastAvailable"]);
    expect(resolveTriggeredTip(CONTEXTUAL_TIPS, seen, prev, next)).toBe(
      "statPointsPiling",
    );
  });
});
