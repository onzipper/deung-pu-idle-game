// @vitest-environment jsdom
/**
 * Issue #55 Wave A, item 1 — `RefinePanel.tsx`'s required-cost chips now show
 * owned/required fraction text (e.g. "0/1") and flip to a red tint when the
 * player can't afford the attempt. Mounts the REAL panel (same
 * `NextIntlClientProvider` + real-store convention as `gameHudLayout.test.tsx`)
 * and selects the one seeded item — `w_sword_t1_rusty` is tier 1, +0 -> +1,
 * so `refineCost(1, 1)` is the deterministic `{ materials: 1, gold: 5 }`
 * (see `engine/config/refine.ts`). Seeding `materials: 0, gold: 0` makes both
 * chips insufficient, so both the fraction text and the red-tint class are
 * exercised in one seed.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RefinePanel } from "@/ui/components/RefinePanel";
import { useGameStore } from "@/ui/store/gameStore";
import type { InventoryItem } from "@/ui/gear/types";
import thMessages from "../../../../messages/th.json";

const WEAPON_ITEM: InventoryItem = {
  instanceId: "inst-weapon",
  templateId: "w_sword_t1_rusty",
  slot: "weapon",
  equippedSlot: null,
  refineLevel: 0,
};

function resetFields() {
  return {
    inventory: [WEAPON_ITEM] as InventoryItem[],
    materials: 0,
    gold: 0,
    world: {
      mapId: "map1",
      zoneIdx: 1,
      kind: "town" as const,
      stage: 1,
      traveling: false,
      left: null,
      right: null,
    },
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
  useGameStore.setState({ inventory: [], materials: 0, gold: 0 });
});

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <RefinePanel onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RefinePanel required-cost chips (issue #55 Wave A)", () => {
  it("renders owned/required fraction text and a red tint when unaffordable", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "ดาบสนิม" }));

    const materialsChip = screen.getByText("0/1");
    const goldChip = screen.getByText("0/5");
    expect(materialsChip).not.toBeNull();
    expect(goldChip).not.toBeNull();

    const materialsContainer = materialsChip.closest("div");
    const goldContainer = goldChip.closest("div");
    expect(materialsContainer?.className).toContain("ddp-bad");
    expect(goldContainer?.className).toContain("ddp-bad");
  });
});
