// @vitest-environment jsdom
/**
 * Issue #55 Wave A, item 2 — `InventoryPanel.tsx`'s widened tab state
 * (`GearSlot | "all"`), default tab "all" (owner-visible decision). Same
 * `NextIntlClientProvider` + real-store mounting convention as
 * `gameHudLayout.test.tsx` (`makeHero` fixture mirrored from there).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { InventoryPanel } from "@/ui/components/InventoryPanel";
import { useGameStore, type HeroSummary } from "@/ui/store/gameStore";
import type { InventoryItem } from "@/ui/gear/types";
import thMessages from "../../../../messages/th.json";

function makeHero(overrides: Partial<HeroSummary> = {}): HeroSummary {
  return {
    cls: "swordsman",
    hp: 100,
    maxHp: 100,
    x: 0,
    skillCd: 0,
    atkBuffMult: 1,
    atkBuffTimer: 0,
    mana: 10,
    maxMana: 10,
    skills: [],
    autoSlots: [null, null, null],
    unlockedSlots: 1,
    dead: false,
    level: 1,
    xpProgress: 0.456,
    atLevelCap: false,
    tier: 1,
    canEvolve: false,
    quest: null,
    statPoints: 0,
    stats: { str: 10, dex: 10, int: 10, vit: 10 },
    primaryStat: "str",
    combatPower: 0,
    equipped: { weapon: null, armor: null },
    hasCommand: false,
    ...overrides,
  };
}

const WEAPON_ITEM: InventoryItem = {
  instanceId: "inst-weapon",
  templateId: "w_sword_t1_rusty",
  slot: "weapon",
  equippedSlot: null,
  refineLevel: 0,
};

const ARMOR_ITEM: InventoryItem = {
  instanceId: "inst-armor",
  templateId: "a_cloth_t1_tunic",
  slot: "armor",
  equippedSlot: null,
  refineLevel: 0,
};

function resetFields() {
  return {
    heroes: [makeHero()],
    inventory: [WEAPON_ITEM, ARMOR_ITEM] as InventoryItem[],
    sessionKnownTemplateIds: [WEAPON_ITEM.templateId, ARMOR_ITEM.templateId],
  };
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

beforeEach(() => {
  useGameStore.setState(resetFields());
});

afterEach(() => {
  cleanup();
  useGameStore.setState({ heroes: [], inventory: [], sessionKnownTemplateIds: [] });
});

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <InventoryPanel onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("InventoryPanel 'all' tab (issue #55 Wave A)", () => {
  it("defaults to the 'all' tab, selected", () => {
    renderPanel();
    const allTab = screen.getByRole("tab", { name: "ทั้งหมด" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
  });

  it("shows items of BOTH slots while the 'all' tab is active", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "ดาบสนิม" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "เสื้อผ้าธรรมดา" })).not.toBeNull();
  });
});
